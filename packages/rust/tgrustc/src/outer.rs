use crate::{args::Args, launcher, lock, sidecar, source};
use std::{
	collections::{BTreeMap, BTreeSet},
	path::{Path, PathBuf},
	time::{Duration, Instant},
};
use tangram_client::prelude::*;
use tokio::io::AsyncWriteExt;

#[cfg(test)]
mod tests;

// Sandbox mount point for referenced artifacts; rustc bakes paths of the form
// `/opt/tangram/store/<id>/...` into emitted `.d` depfiles.
pub(crate) const SANDBOX_STORE_DIR: &str = "/opt/tangram/store";

struct DepfilePaths {
	directories: Vec<(String, PathBuf)>,
	relative_out_dir: Option<(String, String)>,
}

// The phases of one wrapper invocation. `prepare` is the check-ins and the arg
// and env rewriting before the spawn; `materialize` is the checkout and sidecar
// write after it.
#[derive(Default)]
struct Timing {
	materialize: Duration,
	prepare: Duration,
	spawn: Duration,
}

// How the `-L dependency=` snapshot was bounded. Sidecars name the exact stems
// a compilation reaches, but a stem compiled outside the proxy leaves none, and
// an unbounded snapshot contains the crate's own dependents, so compiling the
// crate changes the input to its next compilation and the key can never
// converge. The lockfile bounds the snapshot by package when the sidecars
// cannot bound it by stem.
enum Closure {
	All,
	Packages(BTreeSet<String>),
	Stems(BTreeSet<String>),
	Units,
}

impl Closure {
	fn with_stems(
		direct_stems_by_dir: &BTreeMap<PathBuf, Vec<String>>,
		dependency_dirs: &BTreeSet<PathBuf>,
		lock_root: &Path,
	) -> Self {
		if !dependency_dirs
			.iter()
			.any(|dir| is_shared_dependency_dir(dir))
		{
			return Self::Units;
		}
		let dirs: Vec<&Path> = dependency_dirs.iter().map(PathBuf::as_path).collect();
		let stems: Vec<String> = direct_stems_by_dir.values().flatten().cloned().collect();
		let (visited, complete) = sidecar::closure_from_sidecars(&dirs, &stems);
		if complete {
			return Self::Stems(visited);
		}
		lock::closure(lock_root, &stems).map_or(Self::All, Self::Packages)
	}

	fn contains(&self, stem: &str) -> bool {
		match self {
			Self::All | Self::Units => true,
			Self::Packages(packages) => lock::package_names(stem)
				.iter()
				.any(|name| packages.contains(name)),
			Self::Stems(stems) => stems.contains(stem),
		}
	}

	fn kind(&self) -> &'static str {
		match self {
			Self::All => "all",
			Self::Packages(_) => "packages",
			Self::Stems(_) => "stems",
			Self::Units => "units",
		}
	}
}

// Cargo's legacy build-dir layout shares one `deps` directory among every unit, while the new layout gives each unit its own `build/<package>/<hash>/out` directory.
fn is_shared_dependency_dir(path: &Path) -> bool {
	path.file_name().is_some_and(|name| name == "deps")
}

fn emit_proxy_complete(
	display_name: &str,
	cached: bool,
	closure: &Closure,
	timing: &Timing,
	process_id: &tg::process::Id,
	command_id: &tg::command::Id,
) {
	let closure = closure.kind();
	let prepare_ms = timing.prepare.as_millis();
	let elapsed_ms = timing.spawn.as_millis();
	let materialize_ms = timing.materialize.as_millis();
	eprintln!(
		"proxy_complete crate_name={display_name} cached={cached} closure={closure} prepare_ms={prepare_ms} elapsed_ms={elapsed_ms} materialize_ms={materialize_ms} process_id={process_id} command_id={command_id}"
	);
}

pub async fn run(args: Args) -> tg::Result<()> {
	let run_start = Instant::now();
	let cwd = std::env::current_dir().map_err(|error| tg::error!("failed to read cwd: {error}"))?;
	// Scope the source to the crate's directory and the files that it includes from elsewhere in the Cargo source, so that a sibling crate's edits do not change this crate's key. Fall back to the current directory when Cargo is absent.
	let source_dir =
		std::env::var_os("CARGO_MANIFEST_DIR").map_or_else(|| cwd.clone(), PathBuf::from);
	let source = source::checkin(&source_dir).await?;
	let executable = driver().await?;

	let (mut env, toolchain_artifact, files) = build_env(&args.rustc, &source).await?;
	let host_dirs = host_dirs(&env, &source, files);

	// When the runner is in use, link a build script with a Tangram wrapper even when the build links its other executables without one, so that the build script runs in the runner's sandbox.
	let build_script =
		std::env::var_os("TGRUSTC_PROXY_BUILD_SCRIPTS").is_some() && args.is_build_script();
	if build_script {
		env.remove("TANGRAM_LINKER_PASSTHROUGH");
	}

	// Per-dir BFS roots: cross-compiles route proc-macro and library externs
	// through different dirs, each with its own sidecar set.
	let direct_extern_stems_by_dir = sidecar::direct_extern_stems_by_dir(&args.passthrough);
	let dependency_dirs = sidecar::dependency_dirs(&args.passthrough);
	// Prefer Cargo's top-level lockfile over a vendored crate's lockfile.
	let lock_root =
		std::env::var_os("TGRUSTC_SOURCE_DIR").map_or_else(|| cwd.clone(), PathBuf::from);
	let closure = Closure::with_stems(&direct_extern_stems_by_dir, &dependency_dirs, &lock_root);

	let spawn_args = build_spawn_args(
		&args.passthrough,
		&toolchain_artifact,
		&source.artifact,
		&source.directory,
		&cwd,
		&closure,
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
		retry: std::env::var("TGRUSTC_RETRY").is_ok_and(|value| value == "1"),
		sandbox: Some(tg::process::SandboxArg::Bool(true)),
		stderr: tg::process::Stdio::Log,
		stdin: tg::process::Stdio::Null,
		stdout: tg::process::Stdio::Log,
		..Default::default()
	};

	// Everything up to here is preparation: the source and driver check-ins,
	// and the arg and env rewriting.
	let mut timing = Timing {
		prepare: run_start.elapsed(),
		..Timing::default()
	};

	let spawn_start = Instant::now();
	let process: tg::Process =
		tg::Process::spawn(process_arg, tg::process::spawn::Options::default()).await?;
	let process_id = process.id().unwrap_right().clone();
	append_spawn_log(&process_id);
	let cached = process.cached().unwrap_or(false);
	let command_id = match process.command().await? {
		tg::Either::Left(command) => command.id()?,
		tg::Either::Right(command) => command.id(),
	};
	let outcome = process.wait(tg::process::wait::Options::default()).await?;
	timing.spawn = spawn_start.elapsed();
	let display_name = display_crate_name(args.crate_name.as_deref());

	// A failed compile materializes nothing and `process_output_or_exit` does
	// not return, so emit the timing before it.
	if outcome.exit != 0 {
		emit_proxy_complete(
			&display_name,
			cached,
			&closure,
			&timing,
			&process_id,
			&command_id,
		);
	}

	let output_dir = process_output_or_exit(outcome, &process_id, "the sandbox").await?;

	// Materialize outputs before forwarding logs. Cargo treats rustc's stdout
	// as a pipelining readiness signal; releasing it before checkout completes
	// races the next wrapper's `-L dependency=` directory snapshot.
	let materialize_start = Instant::now();
	if let Some(out_dir) = &args.out_dir {
		materialize_outputs(&output_dir, Path::new(out_dir), &host_dirs, &args).await?;
		// Leave a launcher in place of a build script's executable, so that Cargo runs the build script through the runner.
		if build_script {
			launcher::install(Path::new(out_dir), &args)?;
		}
	}
	timing.materialize = materialize_start.elapsed();

	emit_proxy_complete(
		&display_name,
		cached,
		&closure,
		&timing,
		&process_id,
		&command_id,
	);

	forward_logs(&output_dir, &[]).await?;

	Ok(())
}

pub(crate) async fn driver() -> tg::Result<tg::command::Executable> {
	let self_exe = std::env::current_exe()
		.map_err(|error| tg::error!("failed to read current_exe: {error}"))?;
	let driver_artifact = tg::Artifact::with_referent(checkin(&self_exe).await?.artifact);
	let executable: tg::command::Executable = driver_artifact
		.try_unwrap_file()
		.map_err(|_| tg::error!("the driver artifact must be a file"))?
		.into();
	Ok(executable)
}

// Get the host directories of the artifacts that the sandbox reads its source and the build script's output from, so that the depfiles name them by their host paths.
fn host_dirs(
	env: &tg::value::Map,
	source: &source::Source,
	files: Vec<(tg::artifact::Id, PathBuf)>,
) -> DepfilePaths {
	let id = source.artifact.id();
	let mut directories = vec![(id.to_string(), source.directory.clone())];
	directories.extend(files.into_iter().map(|(id, path)| (id.to_string(), path)));
	if let Some(out_dir) = std::env::var_os("OUT_DIR") {
		let out_dir = PathBuf::from(out_dir);
		if let Some((_, relative)) = &source.relative_out_dir {
			directories.push((format!("{id}/{}", source::OUT_DIR_NAME), out_dir.clone()));
			if let Some(path) = &source.path {
				directories.push((
					format!("{id}/{}/{relative}", path.display()),
					out_dir.clone(),
				));
			}
		}
		if let Some(tg::Value::Template(template)) = env.get("OUT_DIR")
			&& let [tg::template::Component::Artifact(artifact)] = template.components.as_slice()
		{
			directories.push((artifact.id().to_string(), out_dir));
		}
	}

	// Replace the generated directory's aliases before the source root that contains them.
	directories.sort_by_key(|(path, _)| std::cmp::Reverse(path.len()));
	let relative_out_dir = source.relative_out_dir.clone();

	DepfilePaths {
		directories,
		relative_out_dir,
	}
}

// The sandbox env, with the toolchain artifact that provides rustc.
async fn build_env(
	rustc: &str,
	source: &source::Source,
) -> tg::Result<(
	tg::value::Map,
	tg::Artifact,
	Vec<(tg::artifact::Id, PathBuf)>,
)> {
	// Retain the existing filter's distinction between host strings and typed values.
	// Recover paths from the live strings so shell overrides take effect.
	let mut env = tg::process::env::env()?;
	// Remove the runner's filtered workspace, which only build scripts read, so that it does not vary every compilation.
	env.remove("TGRUSTC_RUNNER_WORKSPACE");
	for (name, value) in &mut env {
		if name == "OUT_DIR"
			|| name.starts_with("CARGO_MANIFEST_")
			|| matches!(
				name.as_str(),
				"TGRUSTC_SANDBOX_SDK" | "TGRUSTC_SANDBOX_TOOLCHAIN"
			) {
			continue;
		}
		if is_denied_host_env(name) && !matches!(value, tg::Value::Template(_)) {
			continue;
		}
		if let Ok(raw) = std::env::var(name) {
			*value = proxy::environment_value(name, &raw, template_from_path).await?;
		}
	}
	rewrite_dir_env(&mut env, "OUT_DIR").await?;
	if let Ok(out_dir) = std::env::var("OUT_DIR") {
		rewrite_dir_references(&mut env, "OUT_DIR", &out_dir);
	}
	// Cargo populates these with paths embedding the outer cargo-sandbox's
	// source artifact id, which varies per `cargo.build`. Re-anchor on the
	// crate's source so they depend only on that source.
	override_manifest_env(&mut env, source);
	// Replace the crate's host source directory inside the other variables with its source artifact, so that a path into the crate's source that a build script exports with `cargo:rustc-env`, such as v8's `RUSTY_V8_SRC_BINDING_PATH` when Cargo runs on the host, resolves in the sandbox.
	if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
		rewrite_dir_references(&mut env, "CARGO_MANIFEST_DIR", &manifest_dir);
	}
	// Replace the path to `OUT_DIR` relative to the crate's directory with the path to it relative to the crate's directory in the sandbox's source, so that a macro that resolves the path against the manifest directory finds `OUT_DIR`.
	if let Some((host, sandbox)) = &source.relative_out_dir {
		rewrite_relative_out_dir(&mut env, host, sandbox);
	}
	let files = checkin_source_files(&mut env).await?;

	let toolchain_artifact = resolve_toolchain(&mut env, rustc).await?;

	// `TGRUSTC_SANDBOX_SDK` provides a linker on PATH; final-binary crates
	// shell out to `cc` which the bare host env does not resolve.
	env.remove("TGRUSTC_SANDBOX_SDK");
	if let Some(sdk) = checkin_env_artifact("TGRUSTC_SANDBOX_SDK").await? {
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

	Ok((env, toolchain_artifact, files))
}

// Check in each file of the Cargo source that a variable names by its host path, such as one that Cargo's configuration sets relative to the workspace, so that the path resolves in the sandbox. Return the artifact and the host path of each file.
pub(crate) async fn checkin_source_files(
	env: &mut tg::value::Map,
) -> tg::Result<Vec<(tg::artifact::Id, PathBuf)>> {
	let Some(source_dir) = std::env::var_os("TGRUSTC_SOURCE_DIR") else {
		return Ok(Vec::new());
	};
	let mut files = Vec::new();
	for (name, value) in env.iter_mut() {
		let tg::Value::String(string) = value else {
			continue;
		};
		let path = PathBuf::from(&*string);
		if is_denied_host_env(name)
			|| !path.is_absolute()
			|| !path.starts_with(&source_dir)
			|| !path.is_file()
		{
			continue;
		}
		let artifact = tg::Artifact::with_referent(checkin(&path).await?.artifact);
		files.push((artifact.id(), path));
		let template = tg::Template::with_components([tg::template::Component::Artifact(artifact)]);
		*value = tg::Value::Template(template);
	}

	Ok(files)
}

async fn resolve_toolchain(env: &mut tg::value::Map, rustc: &str) -> tg::Result<tg::Artifact> {
	// `TGRUSTC_SANDBOX_TOOLCHAIN` is set by `cargo.run` to swap the host's
	// rustup toolchain for a wrapped tangram-managed one. When unset (the
	// `cargo.build` path), the host rustc is already wrapped.
	env.remove("TGRUSTC_SANDBOX_TOOLCHAIN");
	if let Some(artifact) = checkin_env_artifact("TGRUSTC_SANDBOX_TOOLCHAIN").await? {
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
	Ok(tg::Artifact::with_referent(
		checkin(&toolchain_dir).await?.artifact,
	))
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
	host_dirs: &DepfilePaths,
	args: &Args,
) -> tg::Result<()> {
	let build = output_dir
		.get("build")
		.await?
		.try_unwrap_directory()
		.map_err(|_| tg::error!("expected build/ to be a directory"))?;
	let store = crate::checkout::entries(&build, out_dir, false).await?;
	// Cargo's incremental fingerprint check `stat`s each depfile entry; the
	// sandbox-internal paths do not exist on the host, so without this rewrite
	// every rebuild reads as "stale: missing X".
	let depfiles = build
		.entries()
		.await?
		.into_keys()
		.filter(|name| {
			Path::new(name)
				.extension()
				.is_some_and(|extension| extension == "d")
		})
		.collect::<Vec<_>>();
	rewrite_depfile_paths(out_dir, &depfiles, host_dirs, &store).await?;
	let own_stems = sidecar::own_stems(args.crate_name.as_deref(), args.extra_filename.as_deref());
	let direct_extern_stems = sidecar::direct_extern_stems(&args.passthrough);
	sidecar::write_sidecars(out_dir, &own_stems, &direct_extern_stems)
}

// Replace the sandbox path of each artifact in the depfiles that this compilation produced with its host directory, both in the paths of files and in the values of environment variables, such as `# env-dep:OUT_DIR=`, which Cargo compares with the values that it sets. Rewrite only this compilation's depfiles, because Cargo can share its output directory between compilations, and the directories of two compilations with the same contents are one artifact.
async fn rewrite_depfile_paths(
	out_dir: &Path,
	depfiles: &[String],
	host_dirs: &DepfilePaths,
	store: &Path,
) -> tg::Result<()> {
	for depfile in depfiles {
		let path = out_dir.join(depfile);
		let contents = tokio::fs::read_to_string(&path).await.map_err(|error| {
			tg::error!(
				"failed to read the depfile {} for rewrite: {error}",
				path.display()
			)
		})?;
		let rewritten = rewrite_depfile_contents(&contents, host_dirs, store);
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

// Escape each host directory as rustc escapes the paths of files in a depfile, or as it escapes the values of environment variables on its `# env-dep:` lines. Replace the sandbox's store last, so that the other artifacts are named by their paths in the host's store.
fn rewrite_depfile_contents(contents: &str, host_dirs: &DepfilePaths, store: &Path) -> String {
	let replacements = host_dirs
		.directories
		.iter()
		.map(|(id, host_dir)| (format!("{SANDBOX_STORE_DIR}/{id}"), host_dir.as_path()))
		.chain([(SANDBOX_STORE_DIR.to_owned(), store)])
		.map(|(sandbox_dir, host_dir)| {
			let host_dir = host_dir.display().to_string();
			let path = host_dir.replace(' ', "\\ ");
			let value = escape_depfile_env_value(&host_dir);
			let sandbox_path = sandbox_dir.replace(' ', "\\ ");
			let sandbox_value = escape_depfile_env_value(&sandbox_dir);
			(sandbox_path, sandbox_value, path, value)
		})
		.collect::<Vec<_>>();
	let mut output = String::with_capacity(contents.len());
	for line in contents.split_inclusive('\n') {
		let env = line.starts_with("# env-dep:");
		let mut line = line.to_owned();
		for (sandbox_path, sandbox_value, path, value) in &replacements {
			line = if env {
				line.replace(sandbox_value, value)
			} else {
				line.replace(sandbox_path, path)
			};
		}

		// Restore the manifest-relative environment values that Cargo compares with its build-script output.
		if env
			&& let Some((host, sandbox)) = &host_dirs.relative_out_dir
			&& let Some((name, value)) = line.split_once('=')
		{
			let sandbox = escape_depfile_env_value(sandbox);
			if let Some(suffix) = value.strip_prefix(&sandbox)
				&& (suffix.is_empty() || suffix == "\n" || suffix.starts_with('/'))
			{
				let host = escape_depfile_env_value(host);
				line = format!("{name}={host}{suffix}");
			}
		}
		output.push_str(&line);
	}

	output
}

fn escape_depfile_env_value(value: &str) -> String {
	let mut escaped = String::with_capacity(value.len());
	for c in value.chars() {
		match c {
			'\n' => escaped.push_str("\\n"),
			'\r' => escaped.push_str("\\r"),
			'\\' => escaped.push_str("\\\\"),
			_ => escaped.push(c),
		}
	}
	escaped
}

pub(crate) async fn process_output_or_exit(
	outcome: tg::process::Outcome,
	process_id: &tg::process::Id,
	label: &str,
) -> tg::Result<tg::Directory> {
	if outcome.exit != 0 {
		if let Some(output) = outcome.output.as_ref()
			&& let Ok(object) = output.clone().try_unwrap_object()
			&& let Ok(output_dir) = object.try_unwrap_directory()
		{
			forward_logs(&output_dir, &[]).await?;
		}
		eprintln!(
			"tgrustc: {label} exited {}. tangram log {process_id}",
			outcome.exit
		);
		std::process::exit(outcome.exit.into());
	}
	let output_dir: tg::Directory = outcome
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
		"HOME" | "USER" | "LOGNAME" | "SHELL" | "SHLVL" | "PWD" | "OLDPWD"
		| "MAIL" | "HOSTNAME" | "TMPDIR" | "TMP" | "TEMP"
		// The ID of the systemd unit or scope that runs the process, which differs in every run.
		| "INVOCATION_ID"
		// The sandbox replaces these for each process, and the outer process's values embed its own sandbox id and token.
		| "TANGRAM_CONFIG" | "TANGRAM_DIRECTORY" | "TANGRAM_MODE" | "TANGRAM_OUTPUT"
		| "TANGRAM_TOKEN" | "TANGRAM_TRACING" | "TANGRAM_URL"
		// Jobserver fds — tangram does not propagate them.
		| "CARGO_MAKEFLAGS" | "MAKEFLAGS"
		// Cargo's job limit — it does not affect a single compilation, and the runner's driver sets `NUM_JOBS` for a build script from its own sandbox's CPUs.
		| "CARGO_BUILD_JOBS" | "NUM_JOBS"
		// Host-side cargo / rustup state — host paths absent in the sandbox.
		| "CARGO_HOME" | "CARGO_TARGET_DIR"
		| "RUSTUP_HOME" | "RUSTUP_TOOLCHAIN"
		| "RUSTC" | "RUSTC_BOOTSTRAP" | "RUSTC_WORKSPACE_WRAPPER"
		// Per-invocation paths embedding the outer cargo sandbox's pid.
		| "TARGET_DIR" | "LD_LIBRARY_PATH" | "DYLD_FALLBACK_LIBRARY_PATH"
		// Locale — varies per host, would destabilise the cache key.
		| "LANG" | "LC_ALL" | "LC_CTYPE" | "LC_MESSAGES"
		| "LC_COLLATE" | "LC_NUMERIC" | "LC_TIME" | "LC_MONETARY"
	) {
		return true;
	}
	// Drop variables by prefix, including the ones that nextest sets for the processes that it runs, such as its setup scripts, which hold the run's ID and temporary paths.
	key.starts_with("NEXTEST")
		|| key.starts_with("TANGRAM_ENV_")
		|| key.starts_with("TGRUSTC_")
		|| key.starts_with("SSH_")
		|| key.starts_with("GPG_")
		|| key.starts_with("XDG_")
}

fn override_manifest_env(env: &mut tg::value::Map, source: &source::Source) {
	if env.contains_key("CARGO_MANIFEST_DIR") {
		let template = source.crate_template("");
		env.insert(
			"CARGO_MANIFEST_DIR".to_owned(),
			tg::Value::Template(template),
		);
	}
	if env.contains_key("CARGO_MANIFEST_PATH") {
		let template = source.crate_template("/Cargo.toml");
		env.insert(
			"CARGO_MANIFEST_PATH".to_owned(),
			tg::Value::Template(template),
		);
	}
}

// If `env[key]` is a host-path string pointing at a directory, checkin the
// directory and replace the value with an artifact template. This is how
// build-script-generated content (cargo writes it to `OUT_DIR`) becomes
// visible to the proxied rustc that consumes it via `env!("OUT_DIR")`.
async fn rewrite_dir_env(env: &mut tg::value::Map, key: &str) -> tg::Result<()> {
	let Ok(path_str) = std::env::var(key) else {
		return Ok(());
	};
	let path = Path::new(&path_str);
	if !path.is_absolute() || !path.is_dir() {
		env.insert(key.to_owned(), path_str.into());
		return Ok(());
	}
	let artifact = tg::Artifact::with_referent(checkin(path).await?.artifact);
	let template = tg::Template::with_components([tg::template::Component::Artifact(artifact)]);
	env.insert(key.to_owned(), tg::Value::Template(template));
	Ok(())
}

// Replace a host directory inside the other variables with the template that `env[key]` holds for it, so that a path that a build script exports with `cargo:rustc-env` resolves in the sandbox.
fn rewrite_dir_references(env: &mut tg::value::Map, key: &str, dir: &str) {
	let Some(tg::Value::Template(dir_template)) = env.get(key).cloned() else {
		return;
	};
	for (name, value) in env.iter_mut() {
		if name == key {
			continue;
		}
		let components = match value {
			tg::Value::String(string) => vec![tg::template::Component::String(string.clone())],
			tg::Value::Template(template) => template.components.clone(),
			_ => continue,
		};
		let mut rewritten = Vec::with_capacity(components.len());
		let mut changed = false;
		for (component_index, component) in components.into_iter().enumerate() {
			let tg::template::Component::String(string) = component else {
				rewritten.push(component);
				continue;
			};
			let mut end = 0;
			for (index, _) in string.match_indices(dir) {
				// Match the original path boundaries, including across artifact components.
				let before = string[..index].chars().next_back();
				let starts_path = before.map_or(component_index == 0, |c| {
					c.is_whitespace() || matches!(c, ':' | '=' | '"' | '\'')
				});
				let after = &string[index + dir.len()..];
				if !starts_path || after.chars().next().is_some_and(|c| c != '/' && c != ':') {
					continue;
				}
				if end < index {
					rewritten.push(tg::template::Component::String(
						string[end..index].to_owned(),
					));
				}
				rewritten.extend(dir_template.components.iter().cloned());
				changed = true;
				end = index + dir.len();
			}
			if end < string.len() {
				rewritten.push(tg::template::Component::String(string[end..].to_owned()));
			}
		}
		if changed {
			*value = tg::Value::Template(tg::Template::with_components(rewritten));
		}
	}
}

// Replace a host path relative to the crate's directory at the start of each string variable with the corresponding sandbox path.
fn rewrite_relative_out_dir(env: &mut tg::value::Map, host: &str, sandbox: &str) {
	let prefix = format!("{host}/");
	for (name, value) in env.iter_mut() {
		if name == "OUT_DIR" {
			continue;
		}
		let tg::Value::String(string) = value else {
			continue;
		};
		if string == host {
			sandbox.clone_into(string);
		} else if let Some(rest) = string.strip_prefix(&prefix) {
			*string = format!("{sandbox}/{rest}");
		}
	}
}

async fn build_spawn_args(
	passthrough: &[String],
	toolchain_artifact: &tg::Artifact,
	source_artifact: &tg::Artifact,
	source_dir: &Path,
	cwd: &Path,
	closure: &Closure,
) -> tg::Result<tg::value::Array> {
	let rustc_template = tg::Template::with_components([
		tg::template::Component::Artifact(toolchain_artifact.clone()),
		tg::template::Component::String("/bin/rustc".to_owned()),
	]);
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
			if let Some(value) = rewrite_search_path(value, closure).await? {
				spawn_args.push(tg::Value::String("-L".to_owned()));
				spawn_args.push(value);
			}
			continue;
		}
		if let Some(value) = arg.strip_prefix("--extern=") {
			spawn_args.push("--extern".to_owned().into());
			spawn_args.push(rewrite_extern(value).await?);
			continue;
		}
		if let Some(value) = arg.strip_prefix("-L") {
			if let Some(value) = rewrite_search_path(value, closure).await? {
				spawn_args.push("-L".to_owned().into());
				spawn_args.push(value);
			}
			continue;
		}
		if arg == "--sysroot" || arg.starts_with("--sysroot=") {
			let path = match arg.strip_prefix("--sysroot=") {
				Some(path) => path,
				None => iter
					.next()
					.ok_or_else(|| tg::error!("expected a sysroot path"))?,
			};
			spawn_args.push("--sysroot".to_owned().into());
			spawn_args.push(template_from_path(path).await?.into());
			continue;
		}
		let value = rewrite_arg(arg, source_artifact, source_dir, cwd);
		let value = if let tg::Value::String(raw) = &value {
			proxy::template_from_string(raw, template_from_path)
				.await?
				.into()
		} else {
			value
		};
		spawn_args.push(value);
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
async fn rewrite_search_path(value: &str, closure: &Closure) -> tg::Result<Option<tg::Value>> {
	let (prefix, path) = match value.split_once('=') {
		Some((kind, p)) => (format!("{kind}="), p),
		None => (String::new(), value),
	};
	let p = Path::new(path);
	// For a target unit, Cargo's new build-dir layout passes a host `dependency=` directory that it never creates. Rustc ignores a missing search directory, so drop it rather than let its absolute path vary the command.
	if prefix == "dependency=" && p.is_absolute() && !p.exists() {
		return Ok(None);
	}
	if !p.is_absolute() || !p.is_dir() {
		return Ok(Some(tg::Value::String(value.to_owned())));
	}
	// Only `dependency=` names the crate graph; the other kinds point at native
	// library dirs the closure says nothing about.
	let closure = (prefix == "dependency=").then_some(closure);
	let artifact = checkin_loadable_search_path(p, closure).await?;
	let template = tg::Template::with_components([
		tg::template::Component::String(prefix),
		tg::template::Component::Artifact(artifact),
	]);
	Ok(Some(tg::Value::Template(template)))
}

async fn checkin_loadable_search_path(
	p: &Path,
	dep_closure: Option<&Closure>,
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
			// A stem closure matches the full `lib<crate>-<hash>` stem so the
			// multi-version case stays correct: the same crate can appear under
			// two hashes and only some are reachable. A package closure is
			// coarser and admits every hash of a reachable package, which only
			// ever admits more than needed.
			if !closure.contains(stem) {
				continue;
			}
		}
		let artifact = tg::Artifact::with_referent(checkin(&path).await?.artifact);
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
		let artifact = tg::Artifact::with_referent(checkin(&entry.path()).await?.artifact);
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
	which::which(rustc).map_err(|error| tg::error!("could not find {rustc} on PATH: {error}"))
}

// SDK and toolchain variables each name one directory, including after shell overrides.
pub(crate) async fn checkin_env_artifact(name: &str) -> tg::Result<Option<tg::Artifact>> {
	let Some(path) = std::env::var_os(name).filter(|path| !path.is_empty()) else {
		return Ok(None);
	};
	Ok(Some(tg::Artifact::with_referent(
		checkin(Path::new(&path)).await?.artifact,
	)))
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

pub(crate) async fn checkin(path: &Path) -> tg::Result<tg::checkin::Output> {
	tg::checkin(tg::checkin::Arg {
		options: tg::checkin::Options {
			deterministic: true,
			ignore: true,
			root: true,
			watch: Some(false),
			..Default::default()
		},
		path: std::path::absolute(path)
			.map_err(|error| tg::error!(!error, "invalid checkin path"))?,
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

// Each `(from, to)` in `substitutions` rewrites every occurrence of `from` to `to`, in order, in stdout before forwarding, which the runner uses to swap the sandbox's `OUT_DIR` placeholders for Cargo's host paths. Stderr is forwarded verbatim.
pub(crate) async fn forward_logs(
	output_dir: &tg::Directory,
	substitutions: &[(&str, &str)],
) -> tg::Result<()> {
	if let Ok(artifact) = output_dir.get("log/stdout").await
		&& let Ok(file) = artifact.try_unwrap_file()
	{
		let bytes = file.bytes().await?;
		let bytes = if substitutions.is_empty() {
			bytes
		} else {
			let mut text = String::from_utf8_lossy(&bytes).into_owned();
			for (from, to) in substitutions {
				text = text.replace(from, to);
			}
			text.into_bytes()
		};
		let mut stdout = tokio::io::stdout();
		stdout
			.write_all(&bytes)
			.await
			.map_err(|error| tg::error!("failed to forward stdout: {error}"))?;
		stdout
			.flush()
			.await
			.map_err(|error| tg::error!(!error, "failed to flush stdout"))?;
	}
	if let Ok(artifact) = output_dir.get("log/stderr").await
		&& let Ok(file) = artifact.try_unwrap_file()
	{
		let bytes = file.bytes().await?;
		let mut stderr = tokio::io::stderr();
		stderr
			.write_all(&bytes)
			.await
			.map_err(|error| tg::error!("failed to forward stderr: {error}"))?;
		stderr
			.flush()
			.await
			.map_err(|error| tg::error!(!error, "failed to flush stderr"))?;
	}
	Ok(())
}

// These paths have already been separated by the caller's argument/environment grammar.
pub(crate) async fn template_from_path(path: &str) -> tg::Result<tg::Template> {
	let output = checkin(Path::new(path)).await?;
	proxy::template_from_referent(&output.artifact)
}
