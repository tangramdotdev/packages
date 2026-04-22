use std::os::unix::process::CommandExt;
use tangram_client::prelude::*;

/// Placeholder for `OUT_DIR` in cached stdout; the outer runner substitutes cargo's actual `OUT_DIR` on replay.
pub(crate) const RUNNER_OUT_DIR_PLACEHOLDER: &str = "@@TGRUSTC_OUT_DIR@@";

pub(crate) fn run_driver() -> tg::Result<()> {
	tracing::info!("running in driver mode");

	let tangram_output = crate::required_env("TANGRAM_OUTPUT")?;
	let rustc_path = crate::required_env("TGRUSTC_RUSTC")?;
	let source_dir = crate::required_env("TGRUSTC_SOURCE")?;
	let out_dir_source = crate::required_env("TGRUSTC_OUT_DIR")?;

	tracing::info!(
		?tangram_output,
		?rustc_path,
		?source_dir,
		?out_dir_source,
		"driver mode environment"
	);

	let build_path = format!("{tangram_output}/build");
	let log_path = format!("{tangram_output}/log");

	std::fs::create_dir_all(&build_path)
		.map_err(|e| tg::error!("failed to create {build_path}: {e}"))?;
	std::fs::create_dir_all(&log_path)
		.map_err(|e| tg::error!("failed to create {log_path}: {e}"))?;

	let rustc_args: Vec<String> = std::env::args().skip(1).collect();

	let stdout_file = std::fs::File::create(format!("{log_path}/stdout"))
		.map_err(|e| tg::error!("failed to create stdout log: {e}"))?;
	let stderr_file = std::fs::File::create(format!("{log_path}/stderr"))
		.map_err(|e| tg::error!("failed to create stderr log: {e}"))?;

	rustix::stdio::dup2_stdout(&stdout_file)
		.map_err(|e| tg::error!("failed to redirect stdout: {e}"))?;
	rustix::stdio::dup2_stderr(&stderr_file)
		.map_err(|e| tg::error!("failed to redirect stderr: {e}"))?;

	tracing::info!(?rustc_args, "executing rustc");

	let error = std::process::Command::new(&rustc_path)
		.args(&rustc_args)
		.current_dir(&source_dir)
		.env("OUT_DIR", &out_dir_source)
		.arg("--out-dir")
		.arg(&build_path)
		.exec();

	// stderr is redirected, so write the error to a file.
	let _ = std::fs::write(
		format!("{tangram_output}/exec_error.txt"),
		format!("exec failed: {error}"),
	);
	Err(tg::error!("failed to exec rustc: {error}"))
}

/// Run a build script inside the Tangram sandbox. See [`RUNNER_OUT_DIR_PLACEHOLDER`] for stdout rewriting.
pub(crate) fn run_runner_driver() -> tg::Result<()> {
	tracing::info!("running in runner driver mode");

	let tangram_output = crate::required_env("TANGRAM_OUTPUT")?;
	let source_dir = crate::required_env("TGRUSTC_RUNNER_SOURCE")?;

	// Manifest subpath: source is the workspace root, crate dir is a subdirectory.
	let manifest_dir = match std::env::var("TGRUSTC_RUNNER_MANIFEST_SUBPATH") {
		Ok(subpath) if !subpath.is_empty() => format!("{source_dir}/{subpath}"),
		_ => source_dir.clone(),
	};

	let out_dir_path = format!("{tangram_output}/{RUNNER_OUT_DIR_PLACEHOLDER}");
	let log_path = format!("{tangram_output}/log");
	std::fs::create_dir_all(&out_dir_path)
		.map_err(|e| tg::error!("failed to create out dir: {e}"))?;
	std::fs::create_dir_all(&log_path).map_err(|e| tg::error!("failed to create log dir: {e}"))?;

	let script_binary = std::env::args()
		.nth(1)
		.ok_or_else(|| tg::error!("expected build script binary path as argument"))?;

	tracing::info!(
		?script_binary,
		?source_dir,
		?manifest_dir,
		?out_dir_path,
		"executing build script"
	);

	// bun checks TMPDIR / BUN_INSTALL_CACHE_DIR for writable locations.
	let tmp_dir_path = format!("{tangram_output}/tmp");
	std::fs::create_dir_all(&tmp_dir_path)
		.map_err(|e| tg::error!("failed to create tmp dir: {e}"))?;

	let output = std::process::Command::new(&script_binary)
		.current_dir(&manifest_dir)
		.env("OUT_DIR", &out_dir_path)
		.env("CARGO_MANIFEST_DIR", &manifest_dir)
		.env("TMPDIR", &tmp_dir_path)
		.env("BUN_INSTALL_CACHE_DIR", &tmp_dir_path)
		.env_remove("TGRUSTC_RUNNER_DRIVER_MODE")
		.env_remove("TGRUSTC_RUNNER_SOURCE")
		.env_remove("TGRUSTC_RUNNER_MANIFEST_SUBPATH")
		.output()
		.map_err(|e| tg::error!("failed to spawn build script: {e}"))?;

	let sandbox_prefix = format!("{tangram_output}/");
	let stdout_text = String::from_utf8_lossy(&output.stdout);
	let stdout_cleaned = stdout_text.replace(&sandbox_prefix, "");

	// Clean up tmp so it stays out of the output artifact.
	let _ = std::fs::remove_dir_all(&tmp_dir_path);

	std::fs::write(format!("{log_path}/stdout"), stdout_cleaned.as_bytes())
		.map_err(|e| tg::error!("failed to write stdout log: {e}"))?;
	std::fs::write(format!("{log_path}/stderr"), &output.stderr)
		.map_err(|e| tg::error!("failed to write stderr log: {e}"))?;

	if !output.status.success() {
		let code = output.status.code().unwrap_or(1);
		std::process::exit(code);
	}

	Ok(())
}
