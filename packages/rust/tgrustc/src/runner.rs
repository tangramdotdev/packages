use crate::outer;
use std::{
	path::{Path, PathBuf},
	time::Instant,
};
use tangram_client::prelude::*;

// Literal name used as `OUT_DIR` inside the runner sandbox. The driver
// writes the build script's outputs under `$TANGRAM_OUTPUT/<placeholder>/`;
// the outer rewrites every occurrence in stdout to cargo's real `OUT_DIR`
// before forwarding, so cached stdout stays sandbox-agnostic.
const OUT_DIR_PLACEHOLDER: &str = "@@TGRUSTC_OUT_DIR@@";

pub async fn run() -> tg::Result<()> {
	let start = Instant::now();

	// argv: [self, "runner", <build-script>, <extra args>...]
	let script_binary = std::env::args()
		.nth(2)
		.ok_or_else(|| tg::error!("expected build script binary path after 'runner'"))?;
	let extra_args: Vec<String> = std::env::args().skip(3).collect();

	let crate_name = std::env::var("CARGO_PKG_NAME").unwrap_or_else(|_| "unknown".into());

	let output = outer::checkin(Path::new(&script_binary)).await?;
	let mut script_artifact = tg::Artifact::with_referent(output.artifact)
		.try_unwrap_file()
		.map_err(|_| tg::error!("expected a build script file"))?;
	// Checkin preserves permissions. Keep supporting inputs without an executable bit.
	if !script_artifact.executable().await? {
		script_artifact = tg::File::builder()
			.contents(script_artifact.contents().await?)
			.dependencies(script_artifact.dependencies().await?)
			.executable(true)
			.build()?;
	}
	let script_artifact = tg::Artifact::from(script_artifact);
	let script_template =
		tg::Template::with_components([tg::template::Component::Artifact(script_artifact)]);

	let manifest_dir = std::env::var("CARGO_MANIFEST_DIR")
		.map_err(|_| tg::error!("CARGO_MANIFEST_DIR is not set"))?;
	let (source_artifact, manifest_subpath) = source(Path::new(&manifest_dir)).await?;
	let manifest_subpath = manifest_subpath
		.map(|path| path.to_string_lossy().into_owned())
		.unwrap_or_default();
	let source_template =
		tg::Template::with_components([tg::template::Component::Artifact(source_artifact)]);

	let self_exe = std::env::current_exe()
		.map_err(|error| tg::error!("failed to read current_exe: {error}"))?;
	let driver_artifact = tg::Artifact::with_referent(outer::checkin(&self_exe).await?.artifact);
	let executable: tg::command::Executable = driver_artifact
		.try_unwrap_file()
		.map_err(|_| tg::error!("the driver artifact must be a file"))?
		.into();

	let env = build_env(source_template, &manifest_subpath).await?;

	let mut spawn_args: tg::value::Array = Vec::with_capacity(1 + extra_args.len());
	spawn_args.push(tg::Value::Template(script_template));
	for arg in &extra_args {
		spawn_args.push(arg.clone().into());
	}

	let process_arg = tg::process::Arg {
		args: spawn_args,
		env,
		executable: Some(executable),
		host: Some(crate::host().to_owned()),
		name: Some(format!("build-script {crate_name}")),
		sandbox: Some(tg::process::SandboxArg::Bool(true)),
		stderr: tg::process::Stdio::Log,
		stdin: tg::process::Stdio::Null,
		stdout: tg::process::Stdio::Log,
		..Default::default()
	};

	let process: tg::Process =
		tg::Process::spawn(process_arg, tg::process::spawn::Options::default()).await?;
	let process_id = process.id().unwrap_right().clone();
	let cached = process.cached().unwrap_or(false);
	let command_id = match process.command().await? {
		tg::Either::Left(command) => command.id()?,
		tg::Either::Right(command) => command.id(),
	};
	let outcome = process.wait(tg::process::wait::Options::default()).await?;
	let elapsed_ms = start.elapsed().as_millis();
	eprintln!(
		"runner_complete crate_name={crate_name} cached={cached} elapsed_ms={elapsed_ms} process_id={process_id} command_id={command_id}"
	);

	let output_dir = outer::process_output_or_exit(outcome, &process_id, "the runner").await?;

	let cargo_out_dir = std::env::var("OUT_DIR").map_err(|_| {
		tg::error!("OUT_DIR is not set; cargo did not provide a build-script out dir")
	})?;
	let build_dir = output_dir
		.get(OUT_DIR_PLACEHOLDER)
		.await?
		.try_unwrap_directory()
		.map_err(|_| {
			tg::error!(
				"expected '{OUT_DIR_PLACEHOLDER}' directory in runner output (id {process_id})"
			)
		})?;
	tg::checkout(tg::checkout::Arg {
		dependencies: true,
		extension: None,
		force: true,
		lock: None,
		nodes: vec![build_dir.to_referent().map(Into::into)],
		path: Some(std::path::PathBuf::from(&cargo_out_dir)),
	})
	.await
	.map(|_| ())?;

	outer::forward_logs(&output_dir, Some((OUT_DIR_PLACEHOLDER, &cargo_out_dir))).await?;

	Ok(())
}

// The source a build script runs against, with the manifest directory's path within it. A crate inside the Cargo source gets the filtered workspace from `TGRUSTC_RUNNER_WORKSPACE` with its own crate grafted back in, so editing another crate's Rust code does not change its inputs. Any other crate gets only its own directory, because a package from a registry or a vendor directory cannot rely on files outside of it.
async fn source(manifest_dir: &Path) -> tg::Result<(tg::Artifact, Option<PathBuf>)> {
	let output = outer::checkin(manifest_dir).await?;
	let (root, subpath) = proxy::artifact_path(&output.artifact)?;
	let Some(subpath) = subpath else {
		return Ok((root, None));
	};
	let crate_artifact = tg::Artifact::with_referent(output.artifact);
	let Some(workspace) = outer::checkin_env_artifact("TGRUSTC_RUNNER_WORKSPACE").await? else {
		return Ok((crate_artifact, None));
	};
	let source_dir = std::env::var_os("TGRUSTC_SOURCE_DIR").ok_or_else(|| {
		tg::error!("TGRUSTC_SOURCE_DIR must be set with TGRUSTC_RUNNER_WORKSPACE")
	})?;
	let output = outer::checkin(Path::new(&source_dir)).await?;
	let (source_root, _) = proxy::artifact_path(&output.artifact)?;
	if source_root.id() != root.id() {
		return Ok((crate_artifact, None));
	}
	let workspace = workspace
		.try_unwrap_directory()
		.map_err(|_| tg::error!("expected TGRUSTC_RUNNER_WORKSPACE to be a directory"))?;
	let workspace = graft(workspace, &subpath, crate_artifact).await?;
	workspace.store().await?;
	Ok((workspace.into(), Some(subpath)))
}

// Replace the entry at `path` with `artifact`, rebuilding each directory along the path.
async fn graft(
	root: tg::Directory,
	path: &Path,
	artifact: tg::Artifact,
) -> tg::Result<tg::Directory> {
	// Load each directory along the path.
	let names = path
		.components()
		.map(|component| component.as_os_str().to_string_lossy().into_owned())
		.collect::<Vec<_>>();
	let mut directories = vec![root];
	for name in names.iter().take(names.len().saturating_sub(1)) {
		let parent = directories.last().unwrap();
		let child = parent
			.get(name)
			.await?
			.try_unwrap_directory()
			.map_err(|_| tg::error!(%name, "expected a directory in the workspace"))?;
		directories.push(child);
	}

	// Rebuild each directory along the path from the bottom up.
	let mut replacement = artifact;
	for (directory, name) in directories.into_iter().zip(&names).rev() {
		let mut entries = directory.entries().await?;
		entries.insert(name.clone(), replacement);
		replacement = tg::Directory::with_entries(entries).into();
	}
	let root = replacement
		.try_unwrap_directory()
		.map_err(|_| tg::error!("expected the grafted workspace to be a directory"))?;

	Ok(root)
}

// Read the live environment so shell exports reach the sandbox.
async fn build_env(
	source_template: tg::Template,
	manifest_subpath: &str,
) -> tg::Result<tg::value::Map> {
	let toolchain_artifact = outer::checkin_env_artifact("TGRUSTC_SANDBOX_TOOLCHAIN").await?;
	let sdk_artifact = outer::checkin_env_artifact("TGRUSTC_SANDBOX_SDK").await?;

	let mut env: tg::value::Map = std::collections::BTreeMap::new();
	for (name, raw) in std::env::vars() {
		if name.starts_with(tg::process::env::PREFIX) {
			continue;
		}
		// Driver re-sets these from sandbox-internal paths.
		if matches!(
			name.as_str(),
			"OUT_DIR" | "CARGO_MANIFEST_DIR" | "CARGO_MANIFEST_PATH"
		) {
			continue;
		}
		if outer::is_denied_host_env(&name) {
			continue;
		}
		let value = proxy::environment_value(&name, &raw, outer::template_from_path).await?;
		env.insert(name, value);
	}

	if let Some(sdk) = sdk_artifact {
		outer::prepend_sdk_to_path(&mut env, sdk);
	}

	// Build scripts that shell out to `rustc --version` (libc, signal-hook,
	// ahash, ...) need RUSTC/CARGO and PATH pointing at sandbox-resident
	// binaries; the host's rustup paths cargo plumbs through do not resolve.
	if let Some(toolchain) = toolchain_artifact {
		env.insert(
			"RUSTC".to_owned(),
			toolchain_subpath(&toolchain, "/bin/rustc"),
		);
		env.insert(
			"CARGO".to_owned(),
			toolchain_subpath(&toolchain, "/bin/cargo"),
		);
		outer::prepend_sdk_to_path(&mut env, toolchain);
	}

	env.insert(
		"TGRUSTC_RUNNER_DRIVER".to_owned(),
		tg::Value::String("1".to_owned()),
	);
	env.insert(
		"TGRUSTC_RUNNER_SOURCE".to_owned(),
		tg::Value::Template(source_template),
	);
	if !manifest_subpath.is_empty() {
		env.insert(
			"TGRUSTC_RUNNER_MANIFEST_SUBPATH".to_owned(),
			tg::Value::String(manifest_subpath.to_owned()),
		);
	}
	Ok(env)
}

pub fn run_driver() -> tg::Result<()> {
	let tangram_output =
		std::env::var("TANGRAM_OUTPUT").map_err(|_| tg::error!("TANGRAM_OUTPUT is not set"))?;
	let source_dir = std::env::var("TGRUSTC_RUNNER_SOURCE")
		.map_err(|_| tg::error!("TGRUSTC_RUNNER_SOURCE is not set"))?;

	let manifest_subpath = std::env::var("TGRUSTC_RUNNER_MANIFEST_SUBPATH").unwrap_or_default();
	let manifest_dir = if manifest_subpath.is_empty() {
		source_dir.clone()
	} else {
		format!("{source_dir}/{manifest_subpath}")
	};

	let out_dir_path = format!("{tangram_output}/{OUT_DIR_PLACEHOLDER}");
	let log_path = format!("{tangram_output}/log");
	let tmp_dir_path = format!("{tangram_output}/tmp");
	for dir in [&out_dir_path, &log_path, &tmp_dir_path] {
		std::fs::create_dir_all(dir)
			.map_err(|error| tg::error!("failed to create {dir}: {error}"))?;
	}

	let script_binary = std::env::args()
		.nth(1)
		.ok_or_else(|| tg::error!("expected build script binary path as argument"))?;
	let extra_args: Vec<String> = std::env::args().skip(2).collect();

	let output = std::process::Command::new(&script_binary)
		.args(&extra_args)
		.current_dir(&manifest_dir)
		.env("OUT_DIR", &out_dir_path)
		.env("CARGO_MANIFEST_DIR", &manifest_dir)
		.env("CARGO_MANIFEST_PATH", format!("{manifest_dir}/Cargo.toml"))
		.env("TMPDIR", &tmp_dir_path)
		.env_remove("TGRUSTC_RUNNER_DRIVER")
		.env_remove("TGRUSTC_RUNNER_SOURCE")
		.env_remove("TGRUSTC_RUNNER_MANIFEST_SUBPATH")
		.output()
		.map_err(|error| tg::error!("failed to spawn build script {script_binary}: {error}"))?;

	// Strip the sandbox prefix so captured stdout becomes sandbox-agnostic.
	// The placeholder it leaves behind gets substituted by the outer with
	// cargo's real OUT_DIR.
	let sandbox_prefix = format!("{tangram_output}/");
	let stdout_text = String::from_utf8_lossy(&output.stdout);
	let stdout_cleaned = stdout_text.replace(&sandbox_prefix, "");

	// tmp is never part of the output artifact.
	let _ = std::fs::remove_dir_all(&tmp_dir_path);

	std::fs::write(format!("{log_path}/stdout"), stdout_cleaned.as_bytes())
		.map_err(|error| tg::error!("failed to write stdout log: {error}"))?;
	std::fs::write(format!("{log_path}/stderr"), &output.stderr)
		.map_err(|error| tg::error!("failed to write stderr log: {error}"))?;

	if !output.status.success() {
		std::process::exit(output.status.code().unwrap_or(1));
	}
	Ok(())
}

fn toolchain_subpath(toolchain: &tg::Artifact, suffix: &str) -> tg::Value {
	tg::Value::Template(tg::Template::with_components([
		tg::template::Component::Artifact(toolchain.clone()),
		tg::template::Component::String(suffix.to_owned()),
	]))
}
