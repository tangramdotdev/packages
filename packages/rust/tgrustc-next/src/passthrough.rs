use crate::args::Args;
use std::{
	os::unix::process::CommandExt,
	path::{Path, PathBuf},
};
use tangram_client::prelude::*;

/// Decide whether this rustc invocation should bypass the sandbox and exec
/// directly on the host. Triggered when `TGRUSTC_PASSTHROUGH_PROJECT_DIR` is
/// set (the `run_integration` Mode 2 contract) and the rustc source file
/// lives inside that directory — i.e. it is a workspace-member compile, not a
/// vendored external dependency.
pub fn applies(args: &Args) -> tg::Result<bool> {
	let Ok(project_dir) = std::env::var("TGRUSTC_PASSTHROUGH_PROJECT_DIR") else {
		return Ok(false);
	};
	let project_dir = PathBuf::from(project_dir);
	let cwd = std::env::current_dir()
		.map_err(|error| tg::error!("failed to read cwd: {error}"))?;
	for arg in &args.passthrough {
		let path = Path::new(arg);
		if path.extension().is_none_or(|ext| ext != "rs") {
			continue;
		}
		let absolute = if path.is_absolute() {
			path.to_path_buf()
		} else {
			cwd.join(path)
		};
		return Ok(absolute.starts_with(&project_dir));
	}
	Ok(false)
}

/// Re-exec the real rustc with the original argv (including the `--out-dir`
/// the parser stripped from `passthrough`). On success this never returns.
pub fn exec(args: &Args) -> tg::Result<()> {
	let mut command = std::process::Command::new(&args.rustc);
	command.args(&args.passthrough);
	if let Some(out_dir) = &args.out_dir {
		command.arg("--out-dir").arg(out_dir);
	}
	let err = command.exec();
	Err(tg::error!("failed to exec rustc for passthrough: {err}"))
}
