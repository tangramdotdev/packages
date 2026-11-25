use crate::{outer, source};
use std::{
	os::unix::process::CommandExt as _,
	path::{Path, PathBuf},
	time::Instant,
};
use tangram_client::prelude::*;

#[cfg(test)]
mod tests;

// Literal name used as `OUT_DIR` inside the runner sandbox. The driver
// writes the build script's outputs under `$TANGRAM_OUTPUT/<placeholder>/`;
// the outer rewrites every occurrence in stdout to cargo's real `OUT_DIR`
// before forwarding, so cached stdout stays sandbox-agnostic.
const OUT_DIR_PLACEHOLDER: &str = "@@TGRUSTC_OUT_DIR@@";

// The placeholder for the directory of the build script's source, which the outer replaces with the host's directory.
const SOURCE_PLACEHOLDER: &str = "@@TGRUSTC_SOURCE@@";

// The placeholder for the path to `OUT_DIR` relative to the manifest directory, which the outer replaces with the path to Cargo's `OUT_DIR` relative to Cargo's manifest directory.
const RELATIVE_OUT_DIR_PLACEHOLDER: &str = "@@TGRUSTC_RELATIVE_OUT_DIR@@";

pub async fn run() -> tg::Result<()> {
	let start = Instant::now();

	// argv: [self, "runner", <build-script>, <extra args>...]
	let script_binary = std::env::args()
		.nth(2)
		.ok_or_else(|| tg::error!("expected build script binary path after 'runner'"))?;
	let extra_args: Vec<String> = std::env::args().skip(3).collect();

	let crate_name = std::env::var("CARGO_PKG_NAME").unwrap_or_else(|_| "unknown".into());

	// Run the build script directly if it cannot run in a sandbox.
	if passthrough(&crate_name) {
		let error = std::process::Command::new(&script_binary)
			.args(&extra_args)
			.exec();
		return Err(tg::error!("failed to exec the build script: {error}"));
	}

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
	let (source_artifact, source_dir) = source(Path::new(&manifest_dir)).await?;
	let manifest_subpath = Path::new(&manifest_dir)
		.strip_prefix(&source_dir)
		.map_err(|error| tg::error!(!error, "expected the crate to be in its source"))?
		.to_string_lossy()
		.into_owned();
	let source_template =
		tg::Template::with_components([tg::template::Component::Artifact(source_artifact)]);

	let executable = outer::driver().await?;

	let (env, files) = build_env(source_template, &manifest_subpath).await?;

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
		retry: std::env::var("TGRUSTC_RETRY").is_ok_and(|value| value == "1"),
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
	let store = crate::checkout::entries(&build_dir, Path::new(&cargo_out_dir), true).await?;

	forward_logs(
		&output_dir,
		&manifest_dir,
		&cargo_out_dir,
		&source_dir,
		&store,
		&files,
	)
	.await?;

	Ok(())
}

// Forward the build script's logs with Cargo's paths in place of the placeholders, and the host's store in place of the sandbox's.
async fn forward_logs(
	output_dir: &tg::Directory,
	manifest_dir: &str,
	out_dir: &str,
	source_dir: &Path,
	store: &Path,
	files: &[(String, PathBuf)],
) -> tg::Result<()> {
	let relative_out_dir = source::relative_path(Path::new(manifest_dir), Path::new(out_dir))
		.display()
		.to_string();
	let source_dir = source_dir.display().to_string();
	let store = store.display().to_string();
	// Name each file of the Cargo source by its host path before the store, so that Cargo watches the caller's file.
	let files = files
		.iter()
		.map(|(sandbox, path)| {
			let sandbox = format!("{}/{sandbox}", outer::SANDBOX_STORE_DIR);
			(sandbox, path.display().to_string())
		})
		.collect::<Vec<_>>();
	let mut substitutions = files
		.iter()
		.map(|(sandbox, host)| (sandbox.as_str(), host.as_str()))
		.collect::<Vec<_>>();
	substitutions.extend([
		(outer::SANDBOX_STORE_DIR, store.as_str()),
		(RELATIVE_OUT_DIR_PLACEHOLDER, relative_out_dir.as_str()),
		(OUT_DIR_PLACEHOLDER, out_dir),
		(SOURCE_PLACEHOLDER, source_dir.as_str()),
	]);
	outer::forward_logs(output_dir, &substitutions).await?;
	Ok(())
}

// The source a build script runs against, with the host directory that it stands for. A crate inside the Cargo source gets the workspace from `TGRUSTC_RUNNER_WORKSPACE` with its own crate grafted in. A sandboxed build filters that workspace, so editing another crate's Rust code does not change the inputs. Any other crate gets only its own directory, because a package from a registry or a vendor directory cannot rely on files outside of it.
async fn source(manifest_dir: &Path) -> tg::Result<(tg::Artifact, PathBuf)> {
	let output = outer::checkin(manifest_dir).await?;
	let crate_artifact = tg::Artifact::with_referent(output.artifact);
	let Some(workspace) = outer::checkin_env_artifact("TGRUSTC_RUNNER_WORKSPACE").await? else {
		return Ok((crate_artifact, manifest_dir.to_owned()));
	};
	let source_dir = std::env::var_os("TGRUSTC_SOURCE_DIR").ok_or_else(|| {
		tg::error!("TGRUSTC_SOURCE_DIR must be set with TGRUSTC_RUNNER_WORKSPACE")
	})?;
	let source_dir = PathBuf::from(source_dir);
	let Ok(subpath) = manifest_dir.strip_prefix(&source_dir) else {
		return Ok((crate_artifact, manifest_dir.to_owned()));
	};
	if subpath.as_os_str().is_empty() {
		return Ok((crate_artifact, manifest_dir.to_owned()));
	}
	let workspace = workspace
		.try_unwrap_directory()
		.map_err(|_| tg::error!("expected TGRUSTC_RUNNER_WORKSPACE to be a directory"))?;
	let workspace = graft(workspace, subpath, crate_artifact).await?;
	workspace.store().await?;
	Ok((workspace.into(), source_dir))
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
) -> tg::Result<(tg::value::Map, Vec<(String, PathBuf)>)> {
	let toolchain_artifact = outer::checkin_env_artifact("TGRUSTC_SANDBOX_TOOLCHAIN").await?;
	let sdk_artifact = outer::checkin_env_artifact("TGRUSTC_SANDBOX_SDK").await?;

	let caller = outer::CallerEnv::read()?;
	let mut env: tg::value::Map = std::collections::BTreeMap::new();
	for (name, raw) in std::env::vars() {
		if name.starts_with(tg::process::env::PREFIX) || caller.contains(&name) {
			continue;
		}
		let raw = caller.path(&name, &raw).into_owned();
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
		// Check in a path that a dependency's build script exported from outside of the store, such as an include directory in its `OUT_DIR`.
		let value = if is_exported_path(&name, &raw) {
			tg::Value::Template(outer::template_from_path(&raw).await?)
		} else {
			proxy::environment_value(&name, &raw, outer::template_from_path).await?
		};
		env.insert(name, value);
	}

	let files = outer::checkin_source_files(&mut env).await?;

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
	Ok((env, files))
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

	// Give the build script the job limit that Cargo would, from this sandbox's CPUs. The outer process removes Cargo's own value so that it does not vary the cache key, and some build scripts, such as those that use the `cmake` crate, build serially without one.
	let jobs = std::thread::available_parallelism().map_or(1, std::num::NonZero::get);

	let output = std::process::Command::new(&script_binary)
		.args(&extra_args)
		.current_dir(&manifest_dir)
		.env("NUM_JOBS", jobs.to_string())
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
	// cargo's real OUT_DIR. Replace the path to `OUT_DIR` relative to the manifest directory, which a build script prints for a macro that resolves paths against the manifest directory, with its own placeholder, so that the outer substitutes Cargo's relative path for it.
	let sandbox_prefix = format!("{tangram_output}/");
	let relative_out_dir = format!(
		"{}/{OUT_DIR_PLACEHOLDER}",
		source::relative_path(Path::new(&manifest_dir), Path::new(&tangram_output)).display()
	);
	let stdout_text = String::from_utf8_lossy(&output.stdout);
	let stdout_cleaned = stdout_text
		.replace(&sandbox_prefix, "")
		.replace(&relative_out_dir, RELATIVE_OUT_DIR_PLACEHOLDER);
	let stdout_cleaned = replace_rerun_paths(&stdout_cleaned, &source_dir);

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

// Replace the source's directory with its placeholder in the paths that a build script tells Cargo to watch, so that Cargo watches the files in the host's directory. A path in any other instruction names the source's artifact.
fn replace_rerun_paths(stdout: &str, source_dir: &str) -> String {
	stdout
		.split_inclusive('\n')
		.map(|line| {
			let path = line
				.strip_prefix("cargo:")
				.map(|line| line.strip_prefix(':').unwrap_or(line))
				.and_then(|line| line.strip_prefix("rerun-if-changed="));
			if path.is_some_and(|path| path.starts_with(source_dir)) {
				line.replacen(source_dir, SOURCE_PLACEHOLDER, 1)
			} else {
				line.to_owned()
			}
		})
		.collect()
}

// Whether a build script runs directly because its package is named in `TGRUSTC_RUNNER_PASSTHROUGH`, for a build script that writes outside of `OUT_DIR`.
fn passthrough(crate_name: &str) -> bool {
	std::env::var("TGRUSTC_RUNNER_PASSTHROUGH")
		.is_ok_and(|names| names.split(',').any(|name| name == crate_name))
}

// Whether a variable holds a path that a dependency's build script exported from outside of the store. Cargo passes a dependency's `cargo::metadata` values in `DEP_` variables.
fn is_exported_path(name: &str, raw: &str) -> bool {
	let path = Path::new(raw);
	name.starts_with("DEP_")
		&& path.is_absolute()
		&& !path.starts_with(outer::SANDBOX_STORE_DIR)
		&& path.exists()
}

fn toolchain_subpath(toolchain: &tg::Artifact, suffix: &str) -> tg::Value {
	tg::Value::Template(tg::Template::with_components([
		tg::template::Component::Artifact(toolchain.clone()),
		tg::template::Component::String(suffix.to_owned()),
	]))
}
