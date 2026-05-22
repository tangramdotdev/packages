use crate::outer;
use std::{io::Cursor, path::Path, time::Instant};
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

	let script_artifact = checkin_script_binary(&script_binary).await?;
	let script_template =
		tg::Template::with_components([tg::template::Component::Artifact(script_artifact)]);

	let manifest_dir = std::env::var("CARGO_MANIFEST_DIR")
		.map_err(|_| tg::error!("CARGO_MANIFEST_DIR is not set"))?;
	let (source_artifact, manifest_subpath) = match parse_artifact_path(&manifest_dir) {
		Some((id, subpath)) => (tg::Artifact::with_id(id), subpath),
		None => (outer::checkin(Path::new(&manifest_dir)).await?, String::new()),
	};
	let source_template =
		tg::Template::with_components([tg::template::Component::Artifact(source_artifact)]);

	let self_exe = std::env::current_exe()
		.map_err(|error| tg::error!("failed to read current_exe: {error}"))?;
	let driver_artifact = outer::checkin(&self_exe).await?;
	let executable: tg::command::Executable = driver_artifact
		.try_unwrap_file()
		.map_err(|_| tg::error!("the driver artifact must be a file"))?
		.into();

	let env = build_env(source_template, &manifest_subpath)?;

	let mut spawn_args: tg::value::Array = Vec::with_capacity(1 + extra_args.len());
	spawn_args.push(tg::Value::Template(script_template));
	for arg in &extra_args {
		spawn_args.push(tg::Value::String(arg.clone()));
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

	let process: tg::Process = tg::Process::spawn(process_arg).await?;
	let process_id = process.id().unwrap_right().clone();
	let cached = process.cached().unwrap_or(false);
	let command_id = process.command().await?.id();
	let wait = process.wait(tg::process::wait::Arg::default()).await?;
	let elapsed_ms = start.elapsed().as_millis();
	eprintln!(
		"runner_complete crate_name={crate_name} cached={cached} elapsed_ms={elapsed_ms} process_id={process_id} command_id={command_id}"
	);

	let output_dir = outer::process_output_or_exit(wait, &process_id, "the runner").await?;

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
		artifact: build_dir.id().into(),
		dependencies: true,
		extension: None,
		force: true,
		lock: None,
		path: Some(std::path::PathBuf::from(&cargo_out_dir)),
	})
	.await
	.map(|_| ())?;

	outer::forward_logs(&output_dir, Some((OUT_DIR_PLACEHOLDER, &cargo_out_dir))).await?;

	Ok(())
}

// Iterate `std::env::vars()` (not `tg::process::env::env()`) so shell
// exports applied by the cargo wrapper or `pre` script reach the sandbox.
// Each value is unrendered to recover an artifact-bearing template when
// tangram paths are embedded.
fn build_env(source_template: tg::Template, manifest_subpath: &str) -> tg::Result<tg::value::Map> {
	let typed = tg::process::env::env()?;
	let toolchain_artifact = typed
		.get("TGRUSTC_SANDBOX_TOOLCHAIN")
		.and_then(outer::extract_artifact);
	let sdk_artifact = typed
		.get("TGRUSTC_SANDBOX_SDK")
		.and_then(outer::extract_artifact);

	let mut env: tg::value::Map = std::collections::BTreeMap::new();
	for (name, raw) in std::env::vars() {
		if name.starts_with(tg::process::env::PREFIX) {
			continue;
		}
		// Driver re-sets these from sandbox-internal paths.
		if name == "OUT_DIR" || name == "CARGO_MANIFEST_DIR" {
			continue;
		}
		if outer::is_denied_host_env(&name) {
			continue;
		}
		env.insert(name, unrender_value(&raw));
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

fn parse_artifact_path(path: &str) -> Option<(tg::artifact::Id, String)> {
	for root in ["/opt/tangram/artifacts/", "/.tangram/artifacts/"] {
		let Some(rest) = path.strip_prefix(root) else {
			continue;
		};
		let (id_str, subpath) = match rest.find('/') {
			Some(slash) => (&rest[..slash], rest[slash + 1..].to_owned()),
			None => (rest, String::new()),
		};
		if let Ok(id) = id_str.parse::<tg::artifact::Id>() {
			return Some((id, subpath));
		}
	}
	None
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

// Read the build script binary bytes and wrap them in a content-addressed
// `tg::File`. Reading directly (vs `tg::checkin`) avoids inflating the
// path-based checkin cache; cargo stages each build script under a per-
// invocation sandbox prefix.
async fn checkin_script_binary(script_binary: &str) -> tg::Result<tg::Artifact> {
	let contents = tokio::fs::read(script_binary)
		.await
		.map_err(|error| tg::error!("failed to read build script {script_binary}: {error}"))?;
	let blob = tg::Blob::with_reader(Cursor::new(contents)).await?;
	let file = tg::File::builder()
		.contents(blob)
		.executable(true)
		.build()
		.map_err(|error| tg::error!(!error, "failed to build script file artifact"))?;
	Ok(file.into())
}

// Unrender if the value embeds a tangram artifact id so artifact components
// resolve inside the runner sandbox. Otherwise return as a plain String.
fn unrender_value(raw: &str) -> tg::Value {
	let Some(end) = outer::artifact_marker_position(raw) else {
		return tg::Value::String(raw.to_owned());
	};
	let prefix = &raw[..end];
	match tg::Template::unrender(prefix, raw) {
		Ok(template) => tg::Value::Template(template),
		Err(_) => tg::Value::String(raw.to_owned()),
	}
}
