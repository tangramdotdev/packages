use std::os::unix::process::CommandExt;
use tangram_client::prelude::*;

/// Deterministic directory name used as the build script's `OUT_DIR` leaf inside
/// the Tangram sandbox. The inner runner sets `OUT_DIR` to
/// `$TANGRAM_OUTPUT/@@TGRUSTC_OUT_DIR@@` and strips the `$TANGRAM_OUTPUT/` prefix
/// from stdout before writing the log. The result is that the cached log contains
/// paths like `@@TGRUSTC_OUT_DIR@@/...` with no sandbox temp path. The outer runner
/// replaces this placeholder with cargo's actual `OUT_DIR` when replaying.
pub(crate) const RUNNER_OUT_DIR_PLACEHOLDER: &str = "@@TGRUSTC_OUT_DIR@@";

/// Run in driver mode inside the Tangram sandbox, executing rustc.
pub(crate) fn run_driver() -> tg::Result<()> {
	#[cfg(feature = "tracing")]
	tracing::info!("running in driver mode");

	// Read required environment variables.
	let tangram_output = crate::required_env("TANGRAM_OUTPUT")?;
	let rustc_path = crate::required_env("TGRUSTC_RUSTC")?;
	let source_dir = crate::required_env("TGRUSTC_SOURCE")?;
	let out_dir_source = crate::required_env("TGRUSTC_OUT_DIR")?;

	#[cfg(feature = "tracing")]
	tracing::info!(
		?tangram_output,
		?rustc_path,
		?source_dir,
		?out_dir_source,
		"driver mode environment"
	);

	// Create output directories for build outputs and logs.
	let build_path = format!("{tangram_output}/build");
	let log_path = format!("{tangram_output}/log");

	std::fs::create_dir_all(&build_path)
		.map_err(|e| tg::error!("failed to create {build_path}: {e}"))?;
	std::fs::create_dir_all(&log_path)
		.map_err(|e| tg::error!("failed to create {log_path}: {e}"))?;

	#[cfg(feature = "tracing")]
	tracing::info!("using OUT_DIR artifact directly, setting up output redirection");

	// Collect rustc arguments from command line (skip argv[0] which is tgrustc).
	let rustc_args: Vec<String> = std::env::args().skip(1).collect();

	// Open log files for stdout/stderr capture.
	let stdout_file = std::fs::File::create(format!("{log_path}/stdout"))
		.map_err(|e| tg::error!("failed to create stdout log: {e}"))?;
	let stderr_file = std::fs::File::create(format!("{log_path}/stderr"))
		.map_err(|e| tg::error!("failed to create stderr log: {e}"))?;

	// Redirect stdout and stderr to the log files using rustix (safe wrapper).
	rustix::stdio::dup2_stdout(&stdout_file)
		.map_err(|e| tg::error!("failed to redirect stdout: {e}"))?;
	rustix::stdio::dup2_stderr(&stderr_file)
		.map_err(|e| tg::error!("failed to redirect stderr: {e}"))?;

	#[cfg(feature = "tracing")]
	tracing::info!(?rustc_args, "executing rustc");

	// Change to source directory and exec rustc.
	let error = std::process::Command::new(&rustc_path)
		.args(&rustc_args)
		.current_dir(&source_dir)
		.env("OUT_DIR", &out_dir_source)
		.arg("--out-dir")
		.arg(&build_path)
		.exec();

	// If we get here, exec failed - write error to file since stderr is redirected.
	let _ = std::fs::write(
		format!("{tangram_output}/exec_error.txt"),
		format!("exec failed: {error}"),
	);

	// If we get here, exec failed.
	Err(tg::error!("failed to exec rustc: {error}"))
}

/// Run in runner driver mode inside the Tangram sandbox, executing a build script.
///
/// The build script's `OUT_DIR` is set to `$TANGRAM_OUTPUT/@@TGRUSTC_OUT_DIR@@`
/// (absolute). Before writing stdout to the log file, the `$TANGRAM_OUTPUT/` prefix
/// is stripped so that paths appear as `@@TGRUSTC_OUT_DIR@@/...` — a deterministic
/// form that does not embed the sandbox temp path. The outer runner (`run_runner`)
/// replaces the placeholder with cargo's actual `OUT_DIR` when replaying.
pub(crate) fn run_runner_driver() -> tg::Result<()> {
	#[cfg(feature = "tracing")]
	tracing::info!("running in runner driver mode");

	let tangram_output = crate::required_env("TANGRAM_OUTPUT")?;
	let source_dir = crate::required_env("TGRUSTC_RUNNER_SOURCE")?;

	// If a manifest subpath is set, the source is the workspace root and the
	// crate directory is a subdirectory within it.
	let manifest_dir = match std::env::var("TGRUSTC_RUNNER_MANIFEST_SUBPATH") {
		Ok(subpath) if !subpath.is_empty() => format!("{source_dir}/{subpath}"),
		_ => source_dir.clone(),
	};

	// Create output structure. The out directory is named with the placeholder
	// constant so that after stripping the TANGRAM_OUTPUT prefix, stdout paths
	// contain only the deterministic placeholder.
	let out_dir_path = format!("{tangram_output}/{RUNNER_OUT_DIR_PLACEHOLDER}");
	let log_path = format!("{tangram_output}/log");
	std::fs::create_dir_all(&out_dir_path)
		.map_err(|e| tg::error!("failed to create out dir: {e}"))?;
	std::fs::create_dir_all(&log_path).map_err(|e| tg::error!("failed to create log dir: {e}"))?;

	// Build script binary is argv[1] (passed as command arg from outer runner).
	let script_binary = std::env::args()
		.nth(1)
		.ok_or_else(|| tg::error!("expected build script binary path as argument"))?;

	#[cfg(feature = "tracing")]
	tracing::info!(
		?script_binary,
		?source_dir,
		?manifest_dir,
		?out_dir_path,
		"executing build script"
	);

	// Create a writable temp directory for tools that need one (e.g., bun checks
	// TMPDIR and BUN_INSTALL_CACHE_DIR for writable locations).
	let tmp_dir_path = format!("{tangram_output}/tmp");
	std::fs::create_dir_all(&tmp_dir_path)
		.map_err(|e| tg::error!("failed to create tmp dir: {e}"))?;

	// Spawn the build script as a subprocess, capturing stdout and stderr.
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

	// Strip the TANGRAM_OUTPUT prefix from stdout so the log contains only the
	// deterministic placeholder (e.g. "@@TGRUSTC_OUT_DIR@@/...") and no sandbox
	// temp paths. The trailing slash is included so paths resolve correctly.
	let sandbox_prefix = format!("{tangram_output}/");
	let stdout_text = String::from_utf8_lossy(&output.stdout);
	let stdout_cleaned = stdout_text.replace(&sandbox_prefix, "");

	// Clean up the temp directory so it doesn't end up in the output artifact.
	let _ = std::fs::remove_dir_all(&tmp_dir_path);

	// Write the cleaned stdout and raw stderr to log files.
	std::fs::write(format!("{log_path}/stdout"), stdout_cleaned.as_bytes())
		.map_err(|e| tg::error!("failed to write stdout log: {e}"))?;
	std::fs::write(format!("{log_path}/stderr"), &output.stderr)
		.map_err(|e| tg::error!("failed to write stderr log: {e}"))?;

	// Propagate the build script's exit code.
	if !output.status.success() {
		let code = output.status.code().unwrap_or(1);
		std::process::exit(code);
	}

	Ok(())
}
