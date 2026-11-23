use crate::args::Args;
use std::path::{Path, PathBuf};
use tangram_client::prelude::*;

// The name of a build script's executable in the directory where the proxy leaves a launcher in its place.
const SCRIPT_NAME: &str = "tgrustc-build-script";

// Move a build script's executable aside in its output directory and leave a symbolic link to this executable in its place, so that Cargo runs the build script through the runner. Cargo runs the file at this path under the new build-dir layout, and a link or a copy of it in the same directory under the legacy layout.
pub fn install(out_dir: &Path, args: &Args) -> tg::Result<()> {
	let crate_name = args.crate_name.as_deref().unwrap_or_default();
	let extra_filename = args.extra_filename.as_deref().unwrap_or_default();
	let launcher = out_dir.join(format!("{crate_name}{extra_filename}"));
	let script = out_dir.join(SCRIPT_NAME);
	std::fs::rename(&launcher, &script).map_err(|source| {
		tg::error!(
			!source,
			path = %launcher.display(),
			"failed to move the build script's executable"
		)
	})?;
	let executable = std::env::current_exe()
		.and_then(std::fs::canonicalize)
		.map_err(|source| tg::error!(!source, "failed to get the path of the executable"))?;
	std::os::unix::fs::symlink(&executable, &launcher).map_err(|source| {
		tg::error!(
			!source,
			path = %launcher.display(),
			"failed to create the build script's launcher"
		)
	})?;
	Ok(())
}

// Get the build script's executable if Cargo started this process through a launcher, which has the build script's name.
pub fn script() -> Option<PathBuf> {
	let program = PathBuf::from(std::env::args_os().next()?);
	let name = program.file_name()?.to_str()?;
	if !(name.starts_with("build_script_") || name.starts_with("build-script-")) {
		return None;
	}
	let script = program.with_file_name(SCRIPT_NAME);
	Some(script)
}
