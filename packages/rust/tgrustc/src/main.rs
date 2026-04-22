use std::os::unix::process::CommandExt;
use std::path::Path;
use tangram_client::prelude::*;

mod args;
mod driver;
mod process;
mod proxy;

fn main() {
	tangram_std::tracing::setup("TGRUSTC_TRACING");

	if let Err(e) = main_inner() {
		eprintln!("rustc proxy failed:");
		tangram_std::error::print_error(e);
		std::process::exit(1);
	}
}

fn main_inner() -> tg::Result<()> {
	if std::env::var("TGRUSTC_DRIVER_MODE").is_ok() {
		return driver::run_driver();
	}

	if std::env::var("TGRUSTC_RUNNER_DRIVER_MODE").is_ok() {
		return driver::run_runner_driver();
	}

	// `tgrustc runner <build-script-binary> [args...]`
	let first_arg = std::env::args().nth(1);
	if first_arg.as_deref() == Some("runner") {
		tg::init()?;
		return tokio::runtime::Builder::new_current_thread()
			.enable_all()
			.build()
			.unwrap()
			.block_on(proxy::run_runner());
	}

	let args = args::Args::parse()?;
	tracing::info!(?args, "parsed arguments");

	// Stdin or single-arg invocations: pass through to rustc directly.
	if args.stdin || args.remaining.len() < 2 {
		tracing::info!("invoking rustc without tangram");
		let rustc_path = std::env::args().nth(1).unwrap();
		// Check out the top-level artifact so the rustc path resolves on disk.
		if !Path::new(&rustc_path).exists() && process::is_artifact_path(&rustc_path) {
			tracing::info!(%rustc_path, "caching rustc artifact for passthrough");
			tg::init()?;
			let rt = tokio::runtime::Builder::new_current_thread()
				.enable_all()
				.build()
				.unwrap();
			rt.block_on(async {
				let template = tangram_std::unrender(&rustc_path)?;
				let artifact = template
					.components
					.into_iter()
					.find_map(|c| c.try_unwrap_artifact().ok())
					.ok_or_else(|| tg::error!("no artifact in rustc path: {rustc_path}"))?;
				tracing::info!(%rustc_path, artifact_id = %artifact.id(), "checking out top-level artifact");
				process::batch_checkout(vec![artifact.id()]).await
			})?;
		}
		let error = std::process::Command::new(&rustc_path)
			.args(std::env::args().skip(2))
			.exec();
		return Err(tg::error!("exec failed: {error}."));
	}

	// TGRUSTC_PASSTHROUGH_PROJECT_DIR gives the workspace root; current_dir() is
	// unreliable because cargo resets it to the current crate per invocation.
	{
		let passthrough_dir = std::env::var("TGRUSTC_PASSTHROUGH_PROJECT_DIR");
		tracing::info!(
			?passthrough_dir,
			source_directory = %args.source_directory,
			crate_name = %args.crate_name,
			"dispatch check"
		);
	}
	if let Ok(project_dir) = std::env::var("TGRUSTC_PASSTHROUGH_PROJECT_DIR")
		&& is_workspace_member(&args.source_directory, &project_dir)
	{
		return passthrough_to_rustc(&args);
	}

	tg::init()?;

	tokio::runtime::Builder::new_current_thread()
		.enable_all()
		.build()
		.unwrap()
		.block_on(proxy::run_proxy(args))?;

	Ok(())
}

/// Canonicalize both sides to handle macOS /var → /private/var symlinks.
fn is_workspace_member(source_directory: &str, project_dir: &str) -> bool {
	let source = std::fs::canonicalize(source_directory)
		.unwrap_or_else(|_| Path::new(source_directory).to_owned());
	let project =
		std::fs::canonicalize(project_dir).unwrap_or_else(|_| Path::new(project_dir).to_owned());
	source.starts_with(&project)
}

/// Invoke rustc directly (bypassing the Tangram process) to preserve incremental compilation.
pub(crate) fn passthrough_to_rustc(args: &args::Args) -> tg::Result<()> {
	tracing::info!(crate_name = %args.crate_name, source_directory = %args.source_directory, "passthrough mode: calling rustc directly");

	// Needed for crates with mixed types (e.g., rlib + cdylib): the cdylib triggers
	// passthrough but the rlib is still consumed by downstream proxy crates.
	maybe_write_passthrough_externs(args);

	let error = std::process::Command::new(&args.rustc)
		.args(std::env::args().skip(2))
		.exec();
	Err(tg::error!("exec failed: {error}."))
}

/// Without this sidecar, `process_dependencies` cannot traverse passthrough'd crates during BFS.
fn maybe_write_passthrough_externs(args: &args::Args) {
	let produces_tracked_output = args.crate_types.is_empty()
		|| args
			.crate_types
			.iter()
			.any(|ct| matches!(ct.as_str(), "lib" | "rlib" | "proc-macro" | "dylib"));
	if !produces_tracked_output || args.externs.is_empty() {
		return;
	}
	let Some(output_dir) = &args.rustc_output_directory else {
		return;
	};

	let extra_filename = args
		.remaining
		.windows(2)
		.find_map(|pair| {
			if pair[0] == "-C" {
				pair[1].strip_prefix("extra-filename=")
			} else {
				None
			}
		})
		.unwrap_or("");

	let externs_filename = format!("lib{}{}.externs", args.crate_name, extra_filename);
	let externs_path = std::path::Path::new(output_dir).join(externs_filename);

	let extern_stems: Vec<String> = args
		.externs
		.iter()
		.filter_map(|(_, path)| {
			std::path::Path::new(path)
				.file_name()
				.and_then(|s| s.to_str())
				.and_then(proxy::extract_stem)
				.map(ToOwned::to_owned)
		})
		.collect();
	let content = extern_stems.join("\n");
	if let Err(e) = std::fs::write(&externs_path, content) {
		tracing::warn!(error = %e, path = %externs_path.display(), "failed to write passthrough .externs file");
	} else {
		tracing::info!(
			crate_name = %args.crate_name,
			path = %externs_path.display(),
			stems = extern_stems.len(),
			"wrote passthrough .externs file"
		);
	}
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

pub(crate) fn required_env(name: &str) -> tg::Result<String> {
	std::env::var(name).map_err(|_| tg::error!("{name} is not set"))
}
