use crate::args::Args;
use std::{
	collections::BTreeMap,
	path::{Path, PathBuf},
};
use tangram_client::prelude::*;
use tokio::io::AsyncWriteExt;

pub async fn run() -> tg::Result<()> {
	let args = Args::parse()?;

	let rustc_path = PathBuf::from(&args.rustc);
	// Cargo invokes the wrapper for query commands like `rustc -vV` with the
	// rustc binary as a bare name (resolved via PATH). We can't sandbox those
	// because we have no path to checkin; passthrough instead.
	let Some(toolchain_dir) = rustc_path.parent().and_then(Path::parent) else {
		use std::os::unix::process::CommandExt as _;
		let mut cmd = std::process::Command::new(&args.rustc);
		if let Some(out_dir) = &args.out_dir {
			cmd.arg("--out-dir").arg(out_dir);
		}
		cmd.args(&args.passthrough);
		let error = cmd.exec();
		return Err(tg::error!("failed to exec rustc: {error}"));
	};
	let toolchain_dir = toolchain_dir.to_path_buf();

	let source_dir = std::env::current_dir()
		.map_err(|error| tg::error!("failed to read cwd: {error}"))?;

	let source_artifact = checkin(&source_dir).await?;
	let toolchain_artifact = checkin(&toolchain_dir).await?;
	let driver_artifact = checkin(
		&std::env::current_exe()
			.map_err(|error| tg::error!("failed to read current_exe: {error}"))?,
	)
	.await?;
	let executable: tg::command::Executable = driver_artifact
		.try_unwrap_file()
		.map_err(|_| tg::error!("driver artifact must be a file"))?
		.into();

	// argv[0] of the spawned process: the real rustc inside the toolchain artifact.
	let rustc_template = tg::Template::with_components([
		tg::template::Component::Artifact(toolchain_artifact.clone()),
		tg::template::Component::String("/bin/rustc".to_owned()),
	]);
	let mut spawn_args: tg::value::Array = Vec::with_capacity(args.passthrough.len() + 1);
	spawn_args.push(tg::Value::Template(rustc_template));
	for arg in &args.passthrough {
		spawn_args.push(rewrite_arg(arg, &source_artifact, &source_dir));
	}

	let mut env: tg::value::Map = std::env::vars()
		.map(|(k, v)| (k, tg::Value::String(v)))
		.collect();
	env.insert(
		"TGRUSTC_NEXT_DRIVER".to_owned(),
		tg::Value::String("1".to_owned()),
	);

	let process_arg = tg::process::Arg {
		args: spawn_args,
		env,
		executable: Some(executable),
		host: Some(crate::host().to_owned()),
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
		std::process::exit(wait.exit.try_into().unwrap_or(1));
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
	if !arg.ends_with(".rs") {
		return tg::Value::String(arg.to_owned());
	}
	let path = Path::new(arg);
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

