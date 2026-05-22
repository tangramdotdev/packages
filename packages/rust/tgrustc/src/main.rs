use tangram_client::prelude::*;

mod args;
mod driver;
mod outer;
mod passthrough;
mod runner;
mod sidecar;

fn main() {
	if let Err(error) = main_inner() {
		eprintln!("tgrustc: {}", error.trace());
		std::process::exit(1);
	}
}

fn main_inner() -> tg::Result<()> {
	if std::env::var("TGRUSTC_DRIVER").is_ok() {
		return driver::run();
	}
	if std::env::var("TGRUSTC_RUNNER_DRIVER").is_ok() {
		return runner::run_driver();
	}
	// The runner subcommand has its own argv shape; dispatch before parsing
	// rustc args.
	if std::env::args().nth(1).as_deref() == Some("runner") {
		tg::init()?;
		return runtime()?.block_on(runner::run());
	}

	let args = args::Args::parse()?;
	if passthrough::applies(&args)? {
		return passthrough::exec(&args);
	}
	tg::init()?;
	runtime()?.block_on(outer::run(args))
}

fn runtime() -> tg::Result<tokio::runtime::Runtime> {
	tokio::runtime::Builder::new_current_thread()
		.enable_all()
		.build()
		.map_err(|error| tg::error!("failed to build tokio runtime: {error}"))
}

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
