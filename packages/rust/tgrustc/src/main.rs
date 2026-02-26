use std::os::unix::process::CommandExt;
use std::path::Path;
use tangram_client::prelude::*;

mod args;
mod driver;
mod process;
mod proxy;

fn main() {
	#[cfg(feature = "tracing")]
	tangram_std::tracing::setup("TGRUSTC_TRACING");

	if let Err(e) = main_inner() {
		eprintln!("rustc proxy failed:");
		tangram_std::error::print_error(e);
		std::process::exit(1);
	}
}

fn main_inner() -> tg::Result<()> {
	// Check if we are running in driver mode (inside the Tangram sandbox).
	if std::env::var("TGRUSTC_DRIVER_MODE").is_ok() {
		return driver::run_driver();
	}

	// Check if we are running in runner driver mode (build script inside sandbox).
	if std::env::var("TGRUSTC_RUNNER_DRIVER_MODE").is_ok() {
		return driver::run_runner_driver();
	}

	// Runner mode: tgrustc runner <build-script-binary> [args...]
	let first_arg = std::env::args().nth(1);
	if first_arg.as_deref() == Some("runner") {
		return tokio::runtime::Builder::new_current_thread()
			.enable_all()
			.build()
			.unwrap()
			.block_on(proxy::run_runner());
	}

	let args = args::Args::parse()?;
	#[cfg(feature = "tracing")]
	tracing::info!(?args, "parsed arguments");

	// If cargo expects to pipe into stdin or contains only a single arg, we immediately invoke rustc without doing anything.
	if args.stdin || args.remaining.len() < 2 {
		#[cfg(feature = "tracing")]
		tracing::info!("invoking rustc without tangram");
		let error = std::process::Command::new(std::env::args().nth(1).unwrap())
			.args(std::env::args().skip(2))
			.exec();
		return Err(tg::error!("exec failed: {error}."));
	}

	// In tg run mode, crates that need linking (build scripts, proc-macros,
	// cdylib, and dylib) require the host linker (cc), which the proxy's sandbox
	// does not provide. Pass through to rustc directly. Build script execution
	// caching is handled by runner mode. This does not affect tangram build,
	// where the SDK provides cc.
	let needs_host_linker = args.crate_name.starts_with("build_script_")
		|| args
			.crate_types
			.iter()
			.any(|ct| matches!(ct.as_str(), "proc-macro" | "cdylib" | "dylib" | "bin"));
	if needs_host_linker && std::env::var("TGRUSTC_RUN_MODE").is_ok() {
		return passthrough_to_rustc(&args);
	}

	// Route workspace members to run_local (mounted sandbox) or passthrough.
	// TGRUSTC_PASSTHROUGH_PROJECT_DIR provides the workspace root for member
	// detection. Note: current_dir() cannot be used as a fallback because
	// cargo sets it to the crate's own source directory per invocation.
	#[cfg(feature = "tracing")]
	{
		let passthrough_dir = std::env::var("TGRUSTC_PASSTHROUGH_PROJECT_DIR");
		let run_mode = std::env::var("TGRUSTC_RUN_MODE");
		tracing::info!(
			?passthrough_dir,
			?run_mode,
			source_directory = %args.source_directory,
			crate_name = %args.crate_name,
			"dispatch check"
		);
	}
	if let Ok(project_dir) = std::env::var("TGRUSTC_PASSTHROUGH_PROJECT_DIR")
		&& is_workspace_member(&args.source_directory, &project_dir)
	{
		if std::env::var("TGRUSTC_RUN_MODE").is_ok() {
			return tokio::runtime::Builder::new_current_thread()
				.enable_all()
				.build()
				.unwrap()
				.block_on(proxy::run_local(args));
		}
		return passthrough_to_rustc(&args);
	}

	tokio::runtime::Builder::new_current_thread()
		.enable_all()
		.build()
		.unwrap()
		.block_on(proxy::run_proxy(args))?;

	Ok(())
}

/// Check whether a crate's source directory is under the project directory,
/// indicating it is a workspace member (not an external dependency).
/// Both paths are canonicalized to handle macOS /var → /private/var symlinks.
fn is_workspace_member(source_directory: &str, project_dir: &str) -> bool {
	let source = std::fs::canonicalize(source_directory)
		.unwrap_or_else(|_| Path::new(source_directory).to_owned());
	let project = std::fs::canonicalize(project_dir)
		.unwrap_or_else(|_| Path::new(project_dir).to_owned());
	source.starts_with(&project)
}

/// Invoke rustc directly without going through a Tangram process.
/// This enables incremental compilation for workspace members.
pub(crate) fn passthrough_to_rustc(args: &args::Args) -> tg::Result<()> {
	#[cfg(feature = "tracing")]
	tracing::info!(crate_name = %args.crate_name, source_directory = %args.source_directory, "passthrough mode: calling rustc directly");

	let error = std::process::Command::new(&args.rustc)
		.args(std::env::args().skip(2))
		.exec();
	Err(tg::error!("exec failed: {error}."))
}

/// Get the host string for the current target.
#[must_use]
pub fn host() -> &'static str {
	#[cfg(all(target_arch = "aarch64", target_os = "macos"))]
	{
		"aarch64-darwin"
	}
	#[cfg(all(target_arch = "aarch64", target_os = "linux"))]
	{
		"aarch64-linux"
	}
	#[cfg(all(target_arch = "x86_64", target_os = "macos"))]
	{
		"x86_64-darwin"
	}
	#[cfg(all(target_arch = "x86_64", target_os = "linux"))]
	{
		"x86_64-linux"
	}
}

/// Read a required environment variable, returning an error if it is not set.
pub(crate) fn required_env(name: &str) -> tg::Result<String> {
	std::env::var(name).map_err(|_| tg::error!("{name} is not set"))
}
