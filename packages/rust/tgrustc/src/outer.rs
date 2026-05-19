use crate::args::Args;
use std::{
	collections::BTreeMap,
	path::{Path, PathBuf},
};
use tangram_client::prelude::*;
use tokio::io::AsyncWriteExt;

pub async fn run(args: Args) -> tg::Result<()> {
	let source_dir =
		std::env::current_dir().map_err(|error| tg::error!("failed to read cwd: {error}"))?;
	let source_artifact = checkin(&source_dir).await?;
	let self_exe = std::env::current_exe()
		.map_err(|error| tg::error!("failed to read current_exe: {error}"))?;
	let driver_artifact = checkin(&self_exe).await?;
	let executable: tg::command::Executable = driver_artifact
		.try_unwrap_file()
		.map_err(|_| tg::error!("the driver artifact must be a file"))?
		.into();

	// `tg::process::env()` reconstitutes typed values from the parent process's
	// `TANGRAM_ENV_*` shadow vars and yields each name exactly once without the
	// reserved prefix. Doing this by hand (e.g. `std::env::vars()`) both loses
	// the typed values and leaks the reserved prefix back to the child.
	let mut env = tg::process::env::env()?;
	rewrite_dir_env(&mut env, "OUT_DIR").await?;

	// `TGRUSTC_SANDBOX_TOOLCHAIN` overrides the toolchain artifact used
	// inside the sub-sandbox. Set by `cargo.run` so the host's bare rustup
	// toolchain is replaced with a `std.wrap`-ed tangram-managed toolchain that
	// runs without a system dynamic linker. When unset (the `cargo.build`
	// path), the host rustc's grandparent directory is content-addressed and
	// used directly, which is sandbox-safe because cargo runs in a tangram-
	// managed env where the rustc on PATH is already wrapped.
	let toolchain_artifact = match env
		.remove("TGRUSTC_SANDBOX_TOOLCHAIN")
		.as_ref()
		.and_then(extract_artifact)
	{
		Some(artifact) => artifact,
		None => {
			let rustc_path = resolve_rustc(&args.rustc)?;
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
			checkin(&toolchain_dir).await?
		}
	};

	// `TGRUSTC_SANDBOX_SDK` provides a linker on PATH inside the sub-
	// sandbox. Without it, final-binary crates fail to link because rustc
	// shells out to `cc` which the bare host env does not resolve.
	if let Some(sdk) = env
		.remove("TGRUSTC_SANDBOX_SDK")
		.as_ref()
		.and_then(extract_artifact)
	{
		prepend_sdk_to_path(&mut env, sdk);
	}

	// Allowlist filter: the sub-sandbox sees only env vars whose names are
	// explicitly known to influence rustc behavior, plus any value carrying a
	// tangram artifact template (the typed shape produced by std.env.arg with
	// dependencies like openssl() or pkgconf() — these are content-addressed
	// so they do not destabilize the cache key, and they carry build-relevant
	// LIBRARY_PATH / CPATH / PKG_CONFIG_PATH entries the linker needs).
	// Everything else (host paths, jobserver fds, locale, terminal state,
	// wrapper plumbing) drops out so it cannot poison the spawn-key cache or
	// warn at runtime.
	env.retain(|key, value| is_allowed_sandbox_env(key, value));

	env.insert(
		"TGRUSTC_DRIVER".to_owned(),
		tg::Value::String("1".to_owned()),
	);

	let spawn_args = build_spawn_args(
		&args.passthrough,
		&toolchain_artifact,
		&source_artifact,
		&source_dir,
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

	let process: tg::Process = tg::Process::spawn(process_arg).await?;
	let process_id = process.id().unwrap_right().clone();
	// When `TGRUSTC_SPAWN_LOG` points at a path, append each spawned
	// process id. Used by test-remote-cache.nu to enumerate sandbox spawns
	// without relying on the database (cache-hit spawns leave no fresh row).
	if let Ok(log_path) = std::env::var("TGRUSTC_SPAWN_LOG")
		&& let Ok(mut f) = std::fs::OpenOptions::new()
			.create(true)
			.append(true)
			.open(&log_path)
	{
		use std::io::Write;
		let _ = writeln!(f, "{process_id}");
	}
	let wait = process.wait(tg::process::wait::Arg::default()).await?;

	if wait.exit != 0 {
		if let Some(output) = wait.output.as_ref()
			&& let Ok(object) = output.clone().try_unwrap_object()
			&& let Ok(output_dir) = object.try_unwrap_directory()
		{
			forward_logs(&output_dir).await?;
		}
		eprintln!(
			"tgrustc: sandbox exited {}. tangram log {process_id}",
			wait.exit
		);
		std::process::exit(wait.exit.into());
	}

	let output_dir: tg::Directory = wait
		.output
		.ok_or_else(|| tg::error!("the sandbox process produced no output (id {process_id})"))?
		.try_unwrap_object()
		.map_err(|_| tg::error!("expected an object output (id {process_id})"))?
		.try_unwrap_directory()
		.map_err(|_| tg::error!("expected a directory output (id {process_id})"))?;

	// Materialize outputs before forwarding logs. Cargo treats rustc's stdout
	// as a pipelining readiness signal; releasing it before checkout completes
	// races the next wrapper's `-L dependency=` directory snapshot.
	if let Some(out_dir) = &args.out_dir {
		let build = output_dir
			.get("build")
			.await?
			.try_unwrap_directory()
			.map_err(|_| tg::error!("expected build/ to be a directory"))?;
		checkout_outputs(&build, Path::new(out_dir)).await?;
	}

	forward_logs(&output_dir).await?;

	Ok(())
}

/// Checkout each output produced by this rustc invocation to its destination
/// in cargo's `--out-dir`. Per-file granularity matters because `--out-dir`
/// (typically `target/<triple>/<profile>/deps`) is shared across every crate
/// in the build; a directory-level checkout with `force: true` would delete
/// sibling crates' outputs.
async fn checkout_outputs(build: &tg::Directory, out_dir: &Path) -> tg::Result<()> {
	tokio::fs::create_dir_all(out_dir)
		.await
		.map_err(|error| tg::error!("failed to create out_dir {}: {error}", out_dir.display()))?;
	let entries: BTreeMap<String, tg::Artifact> = build.entries().await?;
	let mut set = tokio::task::JoinSet::new();
	for (name, artifact) in entries {
		let dest = out_dir.join(&name);
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

/// Allowlist for env vars that propagate into the sub-sandbox rustc
/// invocation. Cache stability depends on minimizing what flows through:
/// every host-varied env var becomes part of the spawn key, and many leak
/// host fds/paths that warn or fail at runtime. Add entries only when a
/// failing fixture names a specific need.
fn is_allowed_sandbox_env(key: &str, value: &tg::Value) -> bool {
	// `OUT_DIR` is rewritten to a content-addressed template by
	// `rewrite_dir_env` so its value is sandbox-safe.
	if key == "OUT_DIR" {
		return true;
	}
	// `PATH` is synthesized in `prepend_sdk_to_path` with sandbox-internal
	// artifact paths.
	if key == "PATH" {
		return true;
	}
	// Cargo-set per-crate metadata that `env!` macros consume.
	if matches!(
		key,
		"CARGO_CRATE_NAME"
			| "CARGO_PRIMARY_PACKAGE"
			| "CARGO_BIN_NAME"
			| "CARGO_MANIFEST_LINKS"
			| "RUSTFLAGS"
			| "RUSTDOCFLAGS"
			| "CARGO_ENCODED_RUSTFLAGS"
	) {
		return true;
	}
	// Cargo-set prefix families.
	if key.starts_with("CARGO_PKG_")
		|| key.starts_with("CARGO_CFG_")
		|| key.starts_with("CARGO_FEATURE_")
		|| key.starts_with("CARGO_DEP_")
		|| key.starts_with("CARGO_BIN_EXE_")
	{
		return true;
	}
	// Template values carry tangram artifact references; their content is
	// content-addressed so passing them through preserves cache stability
	// and lets build-env packages like openssl()/pkgconf() reach the linker.
	if matches!(value, tg::Value::Template(_)) {
		return true;
	}
	false
}

/// If `env[key]` is a host-path string pointing at an existing directory,
/// checkin the directory and replace the value with an artifact-bearing
/// template so the path resolves inside the child sandbox. This is what makes
/// build-script-generated content (cargo writes it to `OUT_DIR`) visible to
/// the proxied rustc invocation that consumes it via `env!("OUT_DIR")`.
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

/// Assemble the spawn-side argv: `[rustc-template, ...rewritten passthrough]`.
/// `--extern crate=path` and `-L kind=path` arguments are rewritten to refer to
/// content-addressed artifacts; positional `.rs` source files are rewritten to
/// reference the source artifact; everything else is forwarded verbatim.
async fn build_spawn_args(
	passthrough: &[String],
	toolchain_artifact: &tg::Artifact,
	source_artifact: &tg::Artifact,
	source_dir: &Path,
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
			spawn_args.push(tg::Value::String("-L".to_owned()));
			spawn_args.push(rewrite_search_path(value).await?);
			continue;
		}
		spawn_args.push(rewrite_arg(arg, source_artifact, source_dir));
	}
	Ok(spawn_args)
}

/// Rewrite the value following `-L` (e.g. `dependency=/host/path`,
/// `native=/host/path`, or a bare `/host/path`) so the directory resolves
/// inside the child sandbox. Even with `--extern` providing the explicit path,
/// rustc still consults `-L dependency=` paths when loading a `.rmeta` to
/// locate the sibling `.rlib`/`.so`; without this the build fails with E0463.
///
/// The synthesized directory contains only files rustc actually loads from a
/// search path: `.rlib`, `.rmeta`, `.so`, `.dylib`, `.a`. Anything else
/// (notably cargo's `.d` depfiles whose content embeds per-process sandbox
/// paths) makes the checkin non-deterministic — a stale snapshot taken before
/// a sibling crate flushes its `.d` to disk produces a different artifact id
/// than a snapshot taken after, blowing the cache key for the current rustc.
async fn rewrite_search_path(value: &str) -> tg::Result<tg::Value> {
	let (prefix, path) = match value.split_once('=') {
		Some((kind, p)) => (format!("{kind}="), p),
		None => (String::new(), value),
	};
	let p = Path::new(path);
	if !p.is_absolute() || !p.is_dir() {
		return Ok(tg::Value::String(value.to_owned()));
	}
	let artifact = checkin_loadable_search_path(p).await?;
	let template = tg::Template::with_components([
		tg::template::Component::String(prefix),
		tg::template::Component::Artifact(artifact),
	]);
	Ok(tg::Value::Template(template))
}

/// Synthesize a directory containing only files rustc loads from a search
/// path. See `rewrite_search_path` for rationale.
async fn checkin_loadable_search_path(p: &Path) -> tg::Result<tg::Artifact> {
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
		let artifact = checkin(&path).await?;
		entries.insert(name.to_owned(), artifact);
	}
	let directory = tg::directory::Builder::with_entries(entries).build();
	Ok(tg::Artifact::Directory(directory))
}

/// Rewrite `name=/path/to/libfoo-<hash>.<ext>` (the value following `--extern`)
/// so it resolves inside the child sandbox. Rustc both (a) inspects the
/// filename to choose a loader (`lib*.rlib`, `lib*.so`, `lib*.rmeta`, ...) and
/// (b) when given a `.rmeta`, looks for the sibling `.rlib`/`.so` in the same
/// directory for the actual code. So we cannot wrap the single file alone; we
/// pull every sibling with the same stem (`libfoo-<hash>`) into a directory
/// artifact and point `--extern` at the named file inside it.
async fn rewrite_extern(value: &str) -> tg::Result<tg::Value> {
	let Some((name, path)) = value.split_once('=') else {
		// `--extern name` with no value is valid rustc syntax (forces ABI compat
		// without supplying a path). Pass through unchanged.
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
	// `lib<crate>-<hash>` — strip just the extension. Filenames without an
	// extension fall back to using the whole filename as the stem.
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
		// A sibling is "same crate" iff its stem matches our stem; this catches
		// `lib<crate>-<hash>.rmeta`, `.rlib`, `.so`, `.dylib` together while
		// excluding other crates' files in the shared deps dir.
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

/// Resolve a rustc invocation to an absolute filesystem path. Cargo passes a
/// bare name when invoking the wrapper from inside a tangram sandbox (rustc
/// lives on PATH); on the host it passes the full path.
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

/// Recover the artifact embedded in an env-var value. Two shapes appear:
///
/// 1. `tg::Value::Template` with an Artifact component — the typed shape, set
///    when the parent process used the tangram runtime to wire the value.
/// 2. `tg::Value::String` containing a rendered artifact path like
///    `<tangram-dir>/artifacts/dir_XXX[/sub]` — what cargo.run produces, which
///    serialises env entries as plain bash `export KEY="<rendered>"` lines
///    that lose the typed-value shadow var.
///
/// The String path infers the prefix by locating the artifact id and feeds it
/// to `tg::Template::unrender`.
fn extract_artifact(value: &tg::Value) -> Option<tg::Artifact> {
	let find_in_template = |t: &tg::Template| -> Option<tg::Artifact> {
		t.components().iter().find_map(|c| match c {
			tg::template::Component::Artifact(a) => Some(a.clone()),
			_ => None,
		})
	};
	match value {
		tg::Value::Template(t) => find_in_template(t),
		tg::Value::String(s) => {
			let markers = ["/dir_01", "/fil_01", "/sym_01"];
			let prefix_end = markers.iter().filter_map(|m| s.find(m)).next()?;
			let prefix = &s[..prefix_end];
			let template = tg::Template::unrender(prefix, s).ok()?;
			find_in_template(&template)
		}
		_ => None,
	}
}

/// Prepend `<sdk>/bin` to the env's PATH, preserving any existing entries.
/// PATH may arrive as either a plain String or as a Template; both shapes are
/// merged into a single Template under the new prefix.
fn prepend_sdk_to_path(env: &mut tg::value::Map, sdk: tg::Artifact) {
	let mut components: Vec<tg::template::Component> = vec![
		tg::template::Component::Artifact(sdk),
		tg::template::Component::String("/bin".to_owned()),
	];
	match env.remove("PATH") {
		Some(tg::Value::String(p)) => {
			components.push(tg::template::Component::String(format!(":{p}")));
		}
		Some(tg::Value::Template(t)) => {
			components.push(tg::template::Component::String(":".to_owned()));
			components.extend(t.components.into_iter());
		}
		_ => {}
	}
	env.insert(
		"PATH".to_owned(),
		tg::Value::Template(tg::Template::with_components(components)),
	);
}

async fn checkin(path: &Path) -> tg::Result<tg::Artifact> {
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

/// Phase 1 path rewriting: only positional `.rs` source files. Everything else
/// passes through as a String. Cargo always invokes rustc with the source file
/// relative to the package source dir; rewrite that single arg to a template
/// pointing into the source artifact so the sandbox can find it.
fn rewrite_arg(arg: &str, source_artifact: &tg::Artifact, source_dir: &Path) -> tg::Value {
	let path = Path::new(arg);
	if path.extension().is_none_or(|ext| ext != "rs") {
		return tg::Value::String(arg.to_owned());
	}
	let absolute = if path.is_absolute() {
		path.to_path_buf()
	} else {
		source_dir.join(path)
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

async fn forward_logs(output_dir: &tg::Directory) -> tg::Result<()> {
	if let Ok(artifact) = output_dir.get("log/stdout").await
		&& let Ok(file) = artifact.try_unwrap_file()
	{
		let bytes = file.bytes().await?;
		tokio::io::stdout()
			.write_all(&bytes)
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
