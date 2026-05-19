use std::{
	fs::{self, File},
	os::unix::process::ExitStatusExt as _,
	path::{Path, PathBuf},
	process::Command,
};
use tangram_client::prelude::*;

/// Inside-sandbox entrypoint. The outer wrapper schedules a tangram process
/// whose executable is this binary with `TGRUSTC_NEXT_DRIVER=1`; tangram
/// provides `TANGRAM_OUTPUT` as the sandbox's output directory. The driver
/// creates `build/` and `log/` under that, redirects rustc's stdio into the
/// log files, injects `--out-dir <build>`, runs the real rustc, then
/// rewrites the leading depfile targets in any `.d` file rustc emitted so
/// the per-process `/opt/tangram/output/<pid>/build/` prefix becomes
/// stable across runs.
pub fn run() -> tg::Result<()> {
	let output =
		std::env::var("TANGRAM_OUTPUT").map_err(|_| tg::error!("TANGRAM_OUTPUT is not set"))?;
	let output = PathBuf::from(output);

	let build = output.join("build");
	let log = output.join("log");
	fs::create_dir_all(&build)
		.map_err(|error| tg::error!("failed to create build dir: {error}"))?;
	fs::create_dir_all(&log).map_err(|error| tg::error!("failed to create log dir: {error}"))?;

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

	// `--remap-path-prefix` normalizes source-side paths in rustc's
	// diagnostics, but does not rewrite the leading depfile target.
	// The post-run sweep below handles the depfile case.
	let remap = format!("{}=/build", build.display());
	let status = Command::new(&rustc)
		.args(&rest)
		.arg("--out-dir")
		.arg(&build)
		.arg("--remap-path-prefix")
		.arg(&remap)
		.status()
		.map_err(|error| tg::error!("failed to spawn rustc {rustc}: {error}"))?;

	// Stabilize the per-process build prefix inside every emitted `.d`
	// file. Without this the leading depfile target embeds the sandbox
	// pid and the output artifact id varies across runs.
	rewrite_depfiles(&build)?;

	let code = if let Some(code) = status.code() {
		code
	} else if let Some(signal) = status.signal() {
		128 + signal
	} else {
		1
	};
	std::process::exit(code);
}

fn rewrite_depfiles(build: &Path) -> tg::Result<()> {
	let entries = match fs::read_dir(build) {
		Ok(entries) => entries,
		Err(_) => return Ok(()),
	};
	let build_prefix = format!("{}/", build.display());
	for entry in entries {
		let entry = entry.map_err(|error| tg::error!("failed to read build entry: {error}"))?;
		let path = entry.path();
		if path.extension().and_then(|s| s.to_str()) != Some("d") {
			continue;
		}
		let contents = fs::read_to_string(&path)
			.map_err(|error| tg::error!("failed to read depfile {}: {error}", path.display()))?;
		let rewritten = contents.replace(&build_prefix, "/build/");
		if rewritten != contents {
			fs::write(&path, rewritten).map_err(|error| {
				tg::error!("failed to write depfile {}: {error}", path.display())
			})?;
		}
	}
	Ok(())
}
