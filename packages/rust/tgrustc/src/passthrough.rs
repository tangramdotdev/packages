use crate::args::Args;
use std::{
	os::unix::process::CommandExt,
	path::{Path, PathBuf},
};
use tangram_client::prelude::*;

// Bypass the sandbox and exec directly on the host. Triggered when
// `TGRUSTC_PASSTHROUGH_PROJECT_DIR` is set (the `run_integration` Mode 2
// contract). Build scripts must passthrough because the SDK's wrapping linker
// emits std.wrap-style binaries that cannot locate the artifacts directory
// outside a tangram-managed tree. Workspace-member compiles (source inside
// the project dir) and probe invocations (no source file) also passthrough;
// vendored deps go through the sandbox.
pub fn applies(args: &Args) -> tg::Result<bool> {
	let Ok(project_dir) = std::env::var("TGRUSTC_PASSTHROUGH_PROJECT_DIR") else {
		return Ok(false);
	};
	if let Some(crate_name) = args.crate_name.as_deref()
		&& crate_name.starts_with("build_script_")
	{
		return Ok(true);
	}
	let project_dir = PathBuf::from(project_dir);
	let cwd = std::env::current_dir().map_err(|error| tg::error!("failed to read cwd: {error}"))?;
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
	Ok(true)
}

pub fn exec(args: &Args) -> tg::Result<()> {
	let mut command = std::process::Command::new(&args.rustc);
	command.args(&args.passthrough);
	if let Some(out_dir) = &args.out_dir {
		command.arg("--out-dir").arg(out_dir);
	}
	let err = command.exec();
	Err(tg::error!("failed to exec rustc for passthrough: {err}"))
}
