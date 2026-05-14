use tangram_client::prelude::*;

mod args;
mod driver;
mod outer;

fn main() {
	if let Err(error) = main_inner() {
		eprintln!("tgrustc-next: {error}");
		std::process::exit(1);
	}
}

fn main_inner() -> tg::Result<()> {
	// Inside-sandbox driver: read TANGRAM_OUTPUT, redirect logs, exec real rustc.
	if std::env::var("TGRUSTC_NEXT_DRIVER").is_ok() {
		return driver::run();
	}

	// Outer wrapper (called by cargo as RUSTC_WRAPPER).
	tg::init()?;
	tokio::runtime::Builder::new_current_thread()
		.enable_all()
		.build()
		.map_err(|error| tg::error!("failed to build tokio runtime: {error}"))?
		.block_on(outer::run())
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
