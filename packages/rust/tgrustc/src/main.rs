use std::os::unix::process::CommandExt;
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

	tokio::runtime::Builder::new_current_thread()
		.enable_all()
		.build()
		.unwrap()
		.block_on(proxy::run_proxy(args))?;

	Ok(())
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
