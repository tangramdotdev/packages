use crate::args::Args;
use std::{
	collections::BTreeMap,
	path::{Path, PathBuf},
};
use tangram_client::prelude::*;
use tokio::io::AsyncWriteExt;

pub async fn run(args: Args) -> tg::Result<()> {
	// Cargo passes the rustc binary either as an absolute path (host `cargo
	// build`) or as a bare name resolved via PATH (cargo inside a tangram
	// sandbox). Normalize both to an absolute path so we can derive the
	// toolchain artifact for sandboxing.
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

	let source_dir = std::env::current_dir()
		.map_err(|error| tg::error!("failed to read cwd: {error}"))?;

	let source_artifact = checkin(&source_dir).await?;
	let toolchain_artifact = checkin(&toolchain_dir).await?;
	let executable: tg::command::Executable = resolve_driver().await?;

	let spawn_args = build_spawn_args(
		&args.passthrough,
		&toolchain_artifact,
		&source_artifact,
		&source_dir,
	)
	.await?;

	// `tg::process::env()` reconstitutes typed values from the parent process's
	// `TANGRAM_ENV_*` shadow vars and yields each name exactly once without the
	// reserved prefix. Doing this by hand (e.g. `std::env::vars()`) both loses
	// the typed values and leaks the reserved prefix back to the child.
	let mut env = tg::process::env::env()?;
	rewrite_dir_env(&mut env, "OUT_DIR").await?;
	env.insert(
		"TGRUSTC_NEXT_DRIVER".to_owned(),
		tg::Value::String("1".to_owned()),
	);

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
	let wait = process.wait(tg::process::wait::Arg::default()).await?;

	if wait.exit != 0 {
		if let Some(output) = wait.output.as_ref()
			&& let Ok(object) = output.clone().try_unwrap_object()
			&& let Ok(output_dir) = object.try_unwrap_directory()
		{
			forward_logs(&output_dir).await?;
		}
		eprintln!(
			"tgrustc-next: sandbox exited {}. tangram log {process_id}",
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

	forward_logs(&output_dir).await?;

	if let Some(out_dir) = &args.out_dir {
		let build = output_dir
			.get("build")
			.await?
			.try_unwrap_directory()
			.map_err(|_| tg::error!("expected build/ to be a directory"))?;
		checkout_outputs(&build, Path::new(out_dir)).await?;
	}

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
	let template =
		tg::Template::with_components([tg::template::Component::Artifact(artifact)]);
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
async fn rewrite_search_path(value: &str) -> tg::Result<tg::Value> {
	let (prefix, path) = match value.split_once('=') {
		Some((kind, p)) => (format!("{kind}="), p),
		None => (String::new(), value),
	};
	let p = Path::new(path);
	if !p.is_absolute() || !p.is_dir() {
		return Ok(tg::Value::String(value.to_owned()));
	}
	let artifact = checkin(p).await?;
	let template = tg::Template::with_components([
		tg::template::Component::String(prefix),
		tg::template::Component::Artifact(artifact),
	]);
	Ok(tg::Value::Template(template))
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
	let mut dir_iter = tokio::fs::read_dir(parent)
		.await
		.map_err(|error| tg::error!("failed to scan extern parent {}: {error}", parent.display()))?;
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

/// Resolve the driver binary to use inside the sandbox. By default we check in
/// `current_exe()`, but the host-built wrapper is dynamically linked against
/// system glibc which the sandbox does not provide. Setting
/// `TGRUSTC_NEXT_DRIVER_EXECUTABLE` to a tangram-built (and `std.wrap`-wrapped)
/// driver path lets the test harness inject a sandbox-compatible binary
/// without rebuilding the wrapper itself.
async fn resolve_driver() -> tg::Result<tg::command::Executable> {
	if let Ok(path) = std::env::var("TGRUSTC_NEXT_DRIVER_EXECUTABLE") {
		let artifact = checkin(Path::new(&path)).await?;
		return Ok(artifact
			.try_unwrap_file()
			.map_err(|_| tg::error!("TGRUSTC_NEXT_DRIVER_EXECUTABLE must point at a file"))?
			.into());
	}
	let self_exe = std::env::current_exe()
		.map_err(|error| tg::error!("failed to read current_exe: {error}"))?;
	let artifact = checkin(&self_exe).await?;
	Ok(artifact
		.try_unwrap_file()
		.map_err(|_| tg::error!("driver artifact must be a file"))?
		.into())
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

