use crate::args::Args;
use std::{os::unix::fs::PermissionsExt as _, path::Path};
use tangram_client::prelude::*;

#[cfg(test)]
mod tests;

// The name of a build script's executable in the directory where the proxy leaves a launcher in its place.
const SCRIPT_NAME: &str = "tgrustc-build-script";

// Move a build script's executable aside in its output directory and leave a launcher in its place, so that Cargo runs the build script through the runner. Cargo runs the file at this path under the new build-dir layout, and a link or a copy of it in the same directory under the legacy layout. The launcher is a regular file, so that Cargo reads its own modification time and can replace it.
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
	let permissions = std::fs::Permissions::from_mode(0o755);
	std::fs::write(&launcher, contents(&executable))
		.and_then(|()| std::fs::set_permissions(&launcher, permissions))
		.map_err(|source| {
			tg::error!(
				!source,
				path = %launcher.display(),
				"failed to create the build script's launcher"
			)
		})?;
	Ok(())
}

// Get the contents of a launcher, which runs the build script beside it directly when Cargo runs without the proxy. Bash passes on the variables whose names are not valid in a shell, such as `CC_x86_64-unknown-linux-gnu`.
fn contents(executable: &Path) -> String {
	let executable = executable.display().to_string().replace('\'', "'\\''");
	format!(
		r#"#!/usr/bin/env bash
script="${{0%/*}}/{SCRIPT_NAME}"
if [ -z "${{TGRUSTC_PROXY_BUILD_SCRIPTS:-}}" ]; then
	exec "$script" "$@"
fi
exec '{executable}' runner "$script" "$@"
"#
	)
}
