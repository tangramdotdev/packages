use std::{fs::File, os::unix::process::CommandExt as _, path::PathBuf, process::Command};
use tangram_client::prelude::*;

/// Inside-sandbox entrypoint. The outer wrapper schedules a tangram process
/// whose executable is this binary with `TGRUSTC_NEXT_DRIVER=1`; tangram
/// provides `TANGRAM_OUTPUT` as the sandbox's output directory. The driver
/// creates `build/` and `log/` under that, redirects rustc's stdio into the
/// log files, injects `--out-dir <build>`, then execs the real rustc.
pub fn run() -> tg::Result<()> {
	let output =
		std::env::var("TANGRAM_OUTPUT").map_err(|_| tg::error!("TANGRAM_OUTPUT is not set"))?;
	let output = PathBuf::from(output);

	let build = output.join("build");
	let log = output.join("log");
	std::fs::create_dir_all(&build)
		.map_err(|error| tg::error!("failed to create build dir: {error}"))?;
	std::fs::create_dir_all(&log)
		.map_err(|error| tg::error!("failed to create log dir: {error}"))?;

	let stdout_file = File::create(log.join("stdout"))
		.map_err(|error| tg::error!("failed to create stdout log: {error}"))?;
	let stderr_file = File::create(log.join("stderr"))
		.map_err(|error| tg::error!("failed to create stderr log: {error}"))?;
	rustix::stdio::dup2_stdout(&stdout_file)
		.map_err(|error| tg::error!("failed to redirect stdout: {error}"))?;
	rustix::stdio::dup2_stderr(&stderr_file)
		.map_err(|error| tg::error!("failed to redirect stderr: {error}"))?;

	let mut argv = std::env::args().skip(1);
	let rustc = argv
		.next()
		.ok_or_else(|| tg::error!("driver: expected rustc path as first argument"))?;
	let rest: Vec<String> = argv.collect();

	// `--remap-path-prefix` normalizes the per-process output path in rustc's
	// dep-info (`.d`) and source-mapped diagnostics. Without it the embedded
	// `/opt/tangram/output/<pid>/build/...` makes the output artifact differ
	// per run for identical inputs, blowing the process cache key.
	let remap = format!("{}=/build", build.display());
	let err = Command::new(&rustc)
		.args(&rest)
		.arg("--out-dir")
		.arg(&build)
		.arg("--remap-path-prefix")
		.arg(&remap)
		.exec();
	Err(tg::error!("failed to exec rustc {rustc}: {err}"))
}
