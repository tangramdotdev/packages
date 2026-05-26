use crate::{args::Args, sidecar};
use std::{
	collections::{BTreeMap, BTreeSet},
	path::{Path, PathBuf},
	time::Instant,
};
use tangram_client::prelude::*;
use tokio::io::AsyncWriteExt;

// Sandbox mount point for referenced artifacts; rustc bakes paths of the form
// `/opt/tangram/artifacts/<id>/...` into emitted `.d` depfiles.
const SANDBOX_ARTIFACTS_DIR: &str = "/opt/tangram/artifacts";

// Markers that prefix tangram artifact ids in rendered env-var strings.
const ARTIFACT_ID_MARKERS: &[&str] = &["/dir_01", "/fil_01", "/sym_01"];

pub async fn run(args: Args) -> tg::Result<()> {
	let cwd = std::env::current_dir().map_err(|error| tg::error!("failed to read cwd: {error}"))?;
	// Scope the source artifact to `CARGO_MANIFEST_DIR` (per-crate) rather than
	// the workspace so a sibling crate's edits cannot blow this crate's
	// spawn-key cache. Fall back to CWD when cargo is absent.
	let source_dir =
		std::env::var_os("CARGO_MANIFEST_DIR").map_or_else(|| cwd.clone(), PathBuf::from);
	let t_src = Instant::now();
	let source_artifact = checkin(&source_dir).await?;
	eprintln!(
		"TGRUSTC_PROBE source_checkin_ms={}",
		t_src.elapsed().as_millis()
	);
	let executable = resolve_driver_executable().await?;

	// `tg::process::env::env()` reconstitutes typed values from the parent's
	// `TANGRAM_ENV_*` shadow vars; `std::env::vars()` would lose the typing.
	let mut env = tg::process::env::env()?;
	rewrite_dir_env(&mut env, "OUT_DIR").await?;
	// Cargo populates these with paths embedding the outer cargo-sandbox's
	// source artifact id, which varies per `cargo.build`. Re-anchor on the
	// per-crate source artifact so they depend only on this crate's source.
	override_manifest_env(&mut env, &source_artifact);

	let toolchain_artifact = resolve_toolchain(&mut env, &args.rustc).await?;

	// `TGRUSTC_SANDBOX_SDK` provides a linker on PATH; final-binary crates
	// shell out to `cc` which the bare host env does not resolve.
	if let Some(sdk) = env
		.remove("TGRUSTC_SANDBOX_SDK")
		.as_ref()
		.and_then(extract_artifact)
	{
		prepend_sdk_to_path(&mut env, sdk);
	}

	// Drop env vars that would poison the spawn key (host paths, locale,
	// jobserver fds) or leak unmapped state. Template values carry
	// content-addressed artifacts and pass through.
	env.retain(|key, value| is_allowed_sandbox_env(key, value));

	env.insert(
		"TGRUSTC_DRIVER".to_owned(),
		tg::Value::String("1".to_owned()),
	);

	// Per-dir BFS roots: cross-compiles route proc-macro and library externs
	// through different dirs, each with its own sidecar set.
	let direct_extern_stems_by_dir = sidecar::direct_extern_stems_by_dir(&args.passthrough);

	let spawn_args = build_spawn_args(
		&args.passthrough,
		&toolchain_artifact,
		&source_artifact,
		&source_dir,
		&cwd,
		&direct_extern_stems_by_dir,
	)
	.await?;

	let name = args
		.crate_name
		.as_deref()
		.map_or_else(|| "rustc".to_owned(), |c| format!("rustc {c}"));
	let process_arg = tg::process::Arg {
		args: spawn_args,
		env,
		executable: Some(executable),
		host: Some(crate::host().to_owned()),
		name: Some(name),
		sandbox: Some(tg::process::SandboxArg::Bool(true)),
		stderr: tg::process::Stdio::Log,
		stdin: tg::process::Stdio::Null,
		stdout: tg::process::Stdio::Log,
		..Default::default()
	};

	let spawn_start = Instant::now();
	let process: tg::Process = tg::Process::spawn(process_arg).await?;
	let process_id = process.id().unwrap_right().clone();
	append_spawn_log(&process_id);
	let cached = process.cached().unwrap_or(false);
	let command_id = process.command().await?.id();
	let wait = process.wait(tg::process::wait::Arg::default()).await?;
	let elapsed_ms = spawn_start.elapsed().as_millis();
	let display_name = display_crate_name(args.crate_name.as_deref());
	eprintln!(
		"proxy_complete crate_name={display_name} cached={cached} elapsed_ms={elapsed_ms} process_id={process_id} command_id={command_id}"
	);

	let output_dir = process_output_or_exit(wait, &process_id, "the sandbox").await?;

	// Materialize outputs before forwarding logs. Cargo treats rustc's stdout
	// as a pipelining readiness signal; releasing it before checkout completes
	// races the next wrapper's `-L dependency=` directory snapshot.
	if let Some(out_dir) = &args.out_dir {
		materialize_outputs(
			&output_dir,
			Path::new(out_dir),
			&source_artifact,
			&source_dir,
			&args,
		)
		.await?;
	}

	forward_logs(&output_dir, None).await?;

	Ok(())
}

async fn resolve_toolchain(env: &mut tg::value::Map, rustc: &str) -> tg::Result<tg::Artifact> {
	// `TGRUSTC_SANDBOX_TOOLCHAIN` is set by `cargo.run` to swap the host's
	// rustup toolchain for a wrapped tangram-managed one. When unset (the
	// `cargo.build` path), the host rustc is already wrapped.
	if let Some(artifact) = env
		.remove("TGRUSTC_SANDBOX_TOOLCHAIN")
		.as_ref()
		.and_then(extract_artifact)
	{
		return Ok(artifact);
	}
	let rustc_path = resolve_rustc(rustc)?;
	let toolchain_dir = rustc_path
		.parent()
		.and_then(Path::parent)
		.ok_or_else(|| {
			tg::error!(
				"cannot derive toolchain root from rustc path: {}",
				rustc_path.display()
			)
		})?
		.to_path_buf();
	checkin(&toolchain_dir).await
}

// `TGRUSTC_SPAWN_LOG` is read by `test-remote-cache.nu` to enumerate sandbox
// spawns without scraping the database; cache-hit spawns leave no fresh row.
fn append_spawn_log(process_id: &tg::process::Id) {
	let Ok(log_path) = std::env::var("TGRUSTC_SPAWN_LOG") else {
		return;
	};
	if let Ok(mut f) = std::fs::OpenOptions::new()
		.create(true)
		.append(true)
		.open(&log_path)
	{
		use std::io::Write;
		let _ = writeln!(f, "{process_id}");
	}
}

async fn materialize_outputs(
	output_dir: &tg::Directory,
	out_dir: &Path,
	source_artifact: &tg::Artifact,
	source_dir: &Path,
	args: &Args,
) -> tg::Result<()> {
	let build = output_dir
		.get("build")
		.await?
		.try_unwrap_directory()
		.map_err(|_| tg::error!("expected build/ to be a directory"))?;
	checkout_artifact_entries(&build, out_dir).await?;
	// Cargo's incremental fingerprint check `stat`s each depfile entry; the
	// sandbox-internal paths do not exist on the host, so without this rewrite
	// every rebuild reads as "stale: missing X".
	rewrite_depfile_source_paths(out_dir, source_artifact, source_dir).await?;
	let own_stems = sidecar::own_stems(args.crate_name.as_deref(), args.extra_filename.as_deref());
	let direct_extern_stems = sidecar::direct_extern_stems(&args.passthrough);
	sidecar::write_sidecars(out_dir, &own_stems, &direct_extern_stems)
}

async fn rewrite_depfile_source_paths(
	out_dir: &Path,
	source_artifact: &tg::Artifact,
	source_dir: &Path,
) -> tg::Result<()> {
	let sandbox_prefix = format!("{}/{}/", SANDBOX_ARTIFACTS_DIR, source_artifact.id());
	let host_prefix = format!("{}/", source_dir.display());
	let mut entries = tokio::fs::read_dir(out_dir).await.map_err(|error| {
		tg::error!(
			"failed to read out_dir {} for depfile rewrite: {error}",
			out_dir.display()
		)
	})?;
	while let Some(entry) = entries
		.next_entry()
		.await
		.map_err(|error| tg::error!("failed to iterate out_dir for depfile rewrite: {error}"))?
	{
		let path = entry.path();
		if path.extension().and_then(|s| s.to_str()) != Some("d") {
			continue;
		}
		let Ok(contents) = tokio::fs::read_to_string(&path).await else {
			continue;
		};
		let rewritten = contents.replace(&sandbox_prefix, &host_prefix);
		if rewritten != contents {
			tokio::fs::write(&path, rewritten).await.map_err(|error| {
				tg::error!(
					"failed to write rewritten depfile {}: {error}",
					path.display()
				)
			})?;
		}
	}
	Ok(())
}

// Per-file checkout: `--out-dir` (typically `target/<triple>/<profile>/deps`)
// is shared across every crate, so a directory-level checkout with
// `force: true` would delete sibling crates' outputs.
pub(crate) async fn checkout_artifact_entries(
	dir: &tg::Directory,
	target: &Path,
) -> tg::Result<()> {
	tokio::fs::create_dir_all(target)
		.await
		.map_err(|error| tg::error!("failed to create {}: {error}", target.display()))?;
	let entries: BTreeMap<String, tg::Artifact> = dir.entries().await?;
	let mut set = tokio::task::JoinSet::new();
	for (name, artifact) in entries {
		let dest = target.join(&name);
		set.spawn(async move {
			tg::checkout(tg::checkout::Arg {
				artifact: artifact.id(),
				dependencies: false,
				extension: None,
				force: true,
				lock: None,
				path: Some(dest),
			})
			.await
			.map(|_| ())
		});
	}
	while let Some(joined) = set.join_next().await {
		joined.map_err(|error| tg::error!("checkout task panicked: {error}"))??;
	}
	Ok(())
}

pub(crate) async fn process_output_or_exit(
	wait: tg::process::wait::Wait,
	process_id: &tg::process::Id,
	label: &str,
) -> tg::Result<tg::Directory> {
	if wait.exit != 0 {
		if let Some(output) = wait.output.as_ref()
			&& let Ok(object) = output.clone().try_unwrap_object()
			&& let Ok(output_dir) = object.try_unwrap_directory()
		{
			forward_logs(&output_dir, None).await?;
		}
		eprintln!(
			"tgrustc: {label} exited {}. tangram log {process_id}",
			wait.exit
		);
		std::process::exit(wait.exit.into());
	}
	let output_dir: tg::Directory = wait
		.output
		.ok_or_else(|| tg::error!("{label} produced no output (id {process_id})"))?
		.try_unwrap_object()
		.map_err(|_| tg::error!("expected an object output (id {process_id})"))?
		.try_unwrap_directory()
		.map_err(|_| tg::error!("expected a directory output (id {process_id})"))?;
	Ok(output_dir)
}

fn is_allowed_sandbox_env(key: &str, value: &tg::Value) -> bool {
	if key == "OUT_DIR" || key == "PATH" {
		return true;
	}
	if matches!(value, tg::Value::Template(_)) {
		return true;
	}
	if matches!(value, tg::Value::String(_)) {
		return !is_denied_host_env(key);
	}
	false
}

pub(crate) fn is_denied_host_env(key: &str) -> bool {
	if matches!(
		key,
		// Shell / process identity — varies per host, no rustc effect.
		"HOME" | "USER" | "LOGNAME" | "SHELL" | "PWD" | "OLDPWD"
		| "MAIL" | "HOSTNAME" | "TMPDIR" | "TMP" | "TEMP"
		// Jobserver fds — tangram does not propagate them.
		| "CARGO_MAKEFLAGS" | "MAKEFLAGS"
		// Host-side cargo / rustup state — host paths absent in the sandbox.
		| "CARGO_HOME" | "CARGO_TARGET_DIR"
		| "RUSTUP_HOME" | "RUSTUP_TOOLCHAIN"
		| "RUSTC" | "RUSTC_BOOTSTRAP" | "RUSTC_WORKSPACE_WRAPPER"
		// Per-invocation paths embedding the outer cargo sandbox's pid.
		| "TARGET_DIR" | "LD_LIBRARY_PATH"
		// Locale — varies per host, would destabilise the cache key.
		| "LANG" | "LC_ALL" | "LC_CTYPE" | "LC_MESSAGES"
		| "LC_COLLATE" | "LC_NUMERIC" | "LC_TIME" | "LC_MONETARY"
	) {
		return true;
	}
	key.starts_with("TANGRAM_ENV_")
		|| key.starts_with("TGRUSTC_")
		|| key.starts_with("SSH_")
		|| key.starts_with("GPG_")
		|| key.starts_with("XDG_")
}

fn override_manifest_env(env: &mut tg::value::Map, source_artifact: &tg::Artifact) {
	if env.contains_key("CARGO_MANIFEST_DIR") {
		env.insert(
			"CARGO_MANIFEST_DIR".to_owned(),
			tg::Value::Template(tg::Template::with_components([
				tg::template::Component::Artifact(source_artifact.clone()),
			])),
		);
	}
	if env.contains_key("CARGO_MANIFEST_PATH") {
		env.insert(
			"CARGO_MANIFEST_PATH".to_owned(),
			tg::Value::Template(tg::Template::with_components([
				tg::template::Component::Artifact(source_artifact.clone()),
				tg::template::Component::String("/Cargo.toml".to_owned()),
			])),
		);
	}
}

// If `env[key]` is a host-path string pointing at a directory, checkin the
// directory and replace the value with an artifact template. This is how
// build-script-generated content (cargo writes it to `OUT_DIR`) becomes
// visible to the proxied rustc that consumes it via `env!("OUT_DIR")`.
async fn rewrite_dir_env(env: &mut tg::value::Map, key: &str) -> tg::Result<()> {
	let Some(tg::Value::String(path_str)) = env.get(key) else {
		return Ok(());
	};
	let path = Path::new(path_str);
	if !path.is_absolute() || !path.is_dir() {
		return Ok(());
	}
	let artifact = checkin(path).await?;
	let template = tg::Template::with_components([tg::template::Component::Artifact(artifact)]);
	env.insert(key.to_owned(), tg::Value::Template(template));
	Ok(())
}

async fn build_spawn_args(
	passthrough: &[String],
	toolchain_artifact: &tg::Artifact,
	source_artifact: &tg::Artifact,
	source_dir: &Path,
	cwd: &Path,
	direct_extern_stems_by_dir: &BTreeMap<PathBuf, Vec<String>>,
) -> tg::Result<tg::value::Array> {
	let rustc_template = tg::Template::with_components([
		tg::template::Component::Artifact(toolchain_artifact.clone()),
		tg::template::Component::String("/bin/rustc".to_owned()),
	]);
	let all_dirs: Vec<&Path> = direct_extern_stems_by_dir.keys().map(PathBuf::as_path).collect();
	let all_stems: Vec<String> = direct_extern_stems_by_dir
		.values()
		.flatten()
		.cloned()
		.collect();
	let (global_closure, global_complete) =
		sidecar::closure_from_sidecars(&all_dirs, &all_stems);
	let global_closure = global_complete.then_some(global_closure);
	let mut spawn_args: tg::value::Array = Vec::with_capacity(passthrough.len() + 1);
	spawn_args.push(tg::Value::Template(rustc_template));
	let mut iter = passthrough.iter();
	while let Some(arg) = iter.next() {
		if arg == "--extern" {
			let value = iter
				.next()
				.ok_or_else(|| tg::error!("--extern was the last argument; expected a value"))?;
			spawn_args.push(tg::Value::String("--extern".to_owned()));
			spawn_args.push(rewrite_extern(value).await?);
			continue;
		}
		if arg == "-L" {
			let value = iter
				.next()
				.ok_or_else(|| tg::error!("-L was the last argument; expected a value"))?;
			spawn_args.push(tg::Value::String("-L".to_owned()));
			spawn_args.push(rewrite_search_path(value, global_closure.as_ref()).await?);
			continue;
		}
		spawn_args.push(rewrite_arg(arg, source_artifact, source_dir, cwd));
	}
	Ok(spawn_args)
}

// Cargo names every build script's compilation `build_script_build`; mirror
// the `build_script_build(pkg)` form tests use by appending `CARGO_PKG_NAME`.
fn display_crate_name(crate_name: Option<&str>) -> String {
	let crate_name = crate_name.unwrap_or("unknown");
	if !crate_name.starts_with("build_script_") {
		return crate_name.to_owned();
	}
	let Ok(pkg) = std::env::var("CARGO_PKG_NAME") else {
		return crate_name.to_owned();
	};
	format!("{}({})", crate_name, pkg.replace('-', "_"))
}

// The synthesized directory contains only files rustc loads from a search
// path (`.rlib`, `.rmeta`, `.so`, `.dylib`, `.a`). Anything else (notably
// cargo's `.d` depfiles, whose content embeds per-process sandbox paths)
// makes the checkin non-deterministic.
async fn rewrite_search_path(
	value: &str,
	global_closure: Option<&BTreeSet<String>>,
) -> tg::Result<tg::Value> {
	let (prefix, path) = match value.split_once('=') {
		Some((kind, p)) => (format!("{kind}="), p),
		None => (String::new(), value),
	};
	let p = Path::new(path);
	if !p.is_absolute() || !p.is_dir() {
		return Ok(tg::Value::String(value.to_owned()));
	}
	let closure = if prefix == "dependency=" {
		global_closure
	} else {
		None
	};
	let artifact = checkin_loadable_search_path(p, closure).await?;
	let template = tg::Template::with_components([
		tg::template::Component::String(prefix),
		tg::template::Component::Artifact(artifact),
	]);
	Ok(tg::Value::Template(template))
}

async fn checkin_loadable_search_path(
	p: &Path,
	dep_closure: Option<&BTreeSet<String>>,
) -> tg::Result<tg::Artifact> {
	let loadable = |ext: &str| matches!(ext, "rlib" | "rmeta" | "so" | "dylib" | "a");
	let mut dir = tokio::fs::read_dir(p)
		.await
		.map_err(|error| tg::error!("failed to read search-path dir {}: {error}", p.display()))?;
	let mut entries: BTreeMap<String, tg::Artifact> = BTreeMap::new();
	while let Some(entry) = dir
		.next_entry()
		.await
		.map_err(|error| tg::error!("failed to iterate search-path dir: {error}"))?
	{
		let path = entry.path();
		let Some(ext) = path.extension().and_then(|s| s.to_str()) else {
			continue;
		};
		if !loadable(ext) {
			continue;
		}
		let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
			continue;
		};
		if let Some(closure) = dep_closure {
			let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
				continue;
			};
			// Match by full `lib<crate>-<hash>` stem so the multi-version case
			// stays correct: the same crate can appear under two hashes and
			// only some are reachable.
			if !closure.contains(stem) {
				continue;
			}
		}
		let artifact = checkin(&path).await?;
		entries.insert(name.to_owned(), artifact);
	}
	let directory = tg::directory::Builder::with_entries(entries).build();
	Ok(tg::Artifact::Directory(directory))
}

// Rustc inspects an extern's filename to choose a loader and, given a
// `.rmeta`, looks for a sibling `.rlib`/`.so` in the same directory. Pull
// every sibling with the matching stem into one directory artifact and point
// `--extern` at the named file inside it.
async fn rewrite_extern(value: &str) -> tg::Result<tg::Value> {
	let Some((name, path)) = value.split_once('=') else {
		// `--extern name` with no value is valid syntax (ABI compat without a
		// path). Pass through.
		return Ok(tg::Value::String(value.to_owned()));
	};
	let file_path = Path::new(path);
	let filename = file_path
		.file_name()
		.and_then(|s| s.to_str())
		.ok_or_else(|| tg::error!("--extern path has no filename: {path}"))?
		.to_owned();
	let parent = file_path
		.parent()
		.ok_or_else(|| tg::error!("--extern path has no parent: {path}"))?;
	let stem = file_path
		.file_stem()
		.and_then(|s| s.to_str())
		.ok_or_else(|| tg::error!("--extern path has no stem: {path}"))?;

	let mut entries: BTreeMap<String, tg::Artifact> = BTreeMap::new();
	let mut dir_iter = tokio::fs::read_dir(parent).await.map_err(|error| {
		tg::error!("failed to scan extern parent {}: {error}", parent.display())
	})?;
	while let Some(entry) = dir_iter
		.next_entry()
		.await
		.map_err(|error| tg::error!("failed to iterate {}: {error}", parent.display()))?
	{
		let sibling = entry.file_name();
		let Some(sibling_str) = sibling.to_str() else {
			continue;
		};
		let sibling_stem = Path::new(sibling_str)
			.file_stem()
			.and_then(|s| s.to_str())
			.unwrap_or(sibling_str);
		if sibling_stem != stem {
			continue;
		}
		let artifact = checkin(&entry.path()).await?;
		entries.insert(sibling_str.to_owned(), artifact);
	}

	let wrapper = tg::Directory::with_entries(entries);
	wrapper.store().await?;
	let template = tg::Template::with_components([
		tg::template::Component::String(format!("{name}=")),
		tg::template::Component::Artifact(wrapper.into()),
		tg::template::Component::String(format!("/{filename}")),
	]);
	Ok(tg::Value::Template(template))
}

fn resolve_rustc(rustc: &str) -> tg::Result<PathBuf> {
	let candidate = Path::new(rustc);
	if candidate.is_absolute() {
		return Ok(candidate.to_path_buf());
	}
	let path = std::env::var_os("PATH")
		.ok_or_else(|| tg::error!("PATH is not set; cannot resolve rustc binary"))?;
	for dir in std::env::split_paths(&path) {
		let candidate = dir.join(rustc);
		if candidate.is_file() {
			return Ok(candidate);
		}
	}
	Err(tg::error!("could not find {rustc} on PATH"))
}

// Recover the artifact embedded in an env-var value. Templates carry it
// directly; Strings come from `cargo.run`'s `export KEY="<rendered>"` form
// which loses the typed shadow var — recover by unrendering at the
// artifact-id prefix.
pub(crate) fn extract_artifact(value: &tg::Value) -> Option<tg::Artifact> {
	match value {
		tg::Value::Template(t) => first_artifact_component(t),
		tg::Value::String(s) => {
			let prefix = &s[..artifact_marker_position(s)?];
			let template = tg::Template::unrender(prefix, s).ok()?;
			first_artifact_component(&template)
		},
		_ => None,
	}
}

fn first_artifact_component(t: &tg::Template) -> Option<tg::Artifact> {
	t.components().iter().find_map(|c| match c {
		tg::template::Component::Artifact(a) => Some(a.clone()),
		_ => None,
	})
}

pub(crate) fn artifact_marker_position(s: &str) -> Option<usize> {
	ARTIFACT_ID_MARKERS.iter().find_map(|m| s.find(m))
}

pub(crate) fn prepend_sdk_to_path(env: &mut tg::value::Map, sdk: tg::Artifact) {
	let mut components: Vec<tg::template::Component> = vec![
		tg::template::Component::Artifact(sdk),
		tg::template::Component::String("/bin".to_owned()),
	];
	match env.remove("PATH") {
		Some(tg::Value::String(p)) => {
			components.push(tg::template::Component::String(format!(":{p}")));
		},
		Some(tg::Value::Template(t)) => {
			components.push(tg::template::Component::String(":".to_owned()));
			components.extend(t.components);
		},
		_ => {},
	}
	env.insert(
		"PATH".to_owned(),
		tg::Value::Template(tg::Template::with_components(components)),
	);
}

pub(crate) async fn resolve_driver_executable() -> tg::Result<tg::command::Executable> {
	let t = Instant::now();
	let (source, artifact) = match driver_artifact_from_env()? {
		Some(artifact) => ("env", artifact),
		None => {
			let self_exe = std::env::current_exe()
				.map_err(|error| tg::error!("failed to read current_exe: {error}"))?;
			("checkin", checkin(&self_exe).await?)
		},
	};
	eprintln!(
		"TGRUSTC_PROBE driver_source={source} driver_resolve_ms={}",
		t.elapsed().as_millis()
	);
	artifact
		.try_unwrap_file()
		.map_err(|_| tg::error!("the driver artifact must be a file"))
		.map(Into::into)
}

fn driver_artifact_from_env() -> tg::Result<Option<tg::Artifact>> {
	let env = tg::process::env::env()?;
	Ok(env.get("TGRUSTC_DRIVER_ARTIFACT").and_then(extract_artifact))
}

pub(crate) async fn checkin(path: &Path) -> tg::Result<tg::Artifact> {
	tg::checkin(tg::checkin::Arg {
		options: tg::checkin::Options {
			deterministic: true,
			ignore: true,
			root: true,
			..Default::default()
		},
		path: path.to_path_buf(),
		updates: vec![],
	})
	.await
}

// Cargo passes positional `.rs` paths either absolute or relative to its CWD
// (the workspace root). Files outside `source_dir` pass through unchanged.
fn rewrite_arg(
	arg: &str,
	source_artifact: &tg::Artifact,
	source_dir: &Path,
	cwd: &Path,
) -> tg::Value {
	let path = Path::new(arg);
	if path.extension().is_none_or(|ext| ext != "rs") {
		return tg::Value::String(arg.to_owned());
	}
	let absolute = if path.is_absolute() {
		path.to_path_buf()
	} else {
		cwd.join(path)
	};
	let Ok(relative) = absolute.strip_prefix(source_dir) else {
		return tg::Value::String(arg.to_owned());
	};
	let subpath = format!("/{}", relative.display());
	let template = tg::Template::with_components([
		tg::template::Component::Artifact(source_artifact.clone()),
		tg::template::Component::String(subpath),
	]);
	tg::Value::Template(template)
}

// `substitute = Some((from, to))` rewrites every occurrence of `from` to `to`
// in stdout before forwarding (used by the runner to swap the sandbox OUT_DIR
// placeholder for cargo's host path). stderr is forwarded verbatim.
pub(crate) async fn forward_logs(
	output_dir: &tg::Directory,
	substitute: Option<(&str, &str)>,
) -> tg::Result<()> {
	if let Ok(artifact) = output_dir.get("log/stdout").await
		&& let Ok(file) = artifact.try_unwrap_file()
	{
		let bytes = file.bytes().await?;
		let bytes: &[u8] = &bytes;
		let replaced;
		let out: &[u8] = match substitute {
			Some((from, to)) => {
				replaced = String::from_utf8_lossy(bytes).replace(from, to);
				replaced.as_bytes()
			},
			None => bytes,
		};
		tokio::io::stdout()
			.write_all(out)
			.await
			.map_err(|error| tg::error!("failed to forward stdout: {error}"))?;
	}
	if let Ok(artifact) = output_dir.get("log/stderr").await
		&& let Ok(file) = artifact.try_unwrap_file()
	{
		let bytes = file.bytes().await?;
		tokio::io::stderr()
			.write_all(&bytes)
			.await
			.map_err(|error| tg::error!("failed to forward stderr: {error}"))?;
	}
	Ok(())
}
