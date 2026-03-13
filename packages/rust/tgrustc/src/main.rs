use std::os::unix::process::CommandExt;
use std::path::Path;
use tangram_client::prelude::*;

mod args;
mod driver;
mod process;
mod proxy;

// FIXME REMOVE
// WATERMARK 14

fn main() {
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
	tracing::info!(?args, "parsed arguments");

	// If cargo expects to pipe into stdin or contains only a single arg, we immediately invoke rustc without doing anything.
	if args.stdin || args.remaining.len() < 2 {
		tracing::info!("invoking rustc without tangram");
		let rustc_path = std::env::args().nth(1).unwrap();
		// If the rustc path is an artifact store path that does not exist on
		// disk, cache it so the exec can succeed.
		if !Path::new(&rustc_path).exists()
			&& (rustc_path.contains("/.tangram/artifacts/")
				|| rustc_path.contains("/opt/tangram/artifacts/"))
		{
			tracing::info!(%rustc_path, "caching rustc artifact for passthrough");
			let tg_client = tg::Client::with_env()?;
			let rt = tokio::runtime::Builder::new_current_thread()
				.enable_all()
				.build()
				.unwrap();
			rt.block_on(async {
				// Cache the top-level directory artifact, not the inner file.
				// `extract_artifact_from_path` navigates into subdirectories,
				// but we need the whole directory materialized on disk so the
				// full path (e.g. dir_xxx/bin/rustc) resolves.
				let template = tangram_std::unrender(&rustc_path)?;
				let artifact = template
					.components
					.into_iter()
					.find_map(|c| c.try_unwrap_artifact().ok())
					.ok_or_else(|| tg::error!("no artifact in rustc path: {rustc_path}"))?;
				tracing::info!(%rustc_path, artifact_id = %artifact.id(), "caching top-level artifact");
				process::batch_cache(&tg_client, vec![artifact.id()]).await
			})?;
		}
		let error = std::process::Command::new(&rustc_path)
			.args(std::env::args().skip(2))
			.exec();
		return Err(tg::error!("exec failed: {error}."));
	}

	// Route workspace members to passthrough. TGRUSTC_PASSTHROUGH_PROJECT_DIR
	// provides the workspace root for member detection. Note: current_dir()
	// cannot be used as a fallback because cargo sets it to the crate's own
	// source directory per invocation.
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
	let project =
		std::fs::canonicalize(project_dir).unwrap_or_else(|_| Path::new(project_dir).to_owned());
	source.starts_with(&project)
}

/// Invoke rustc directly without going through a Tangram process.
/// This enables incremental compilation for workspace members.
pub(crate) fn passthrough_to_rustc(args: &args::Args) -> tg::Result<()> {
	tracing::info!(crate_name = %args.crate_name, source_directory = %args.source_directory, "passthrough mode: calling rustc directly");

	// Write an .externs sidecar file before exec so that downstream proxy
	// crates can compute the transitive dependency closure. This is needed
	// when a crate has mixed crate types (e.g., rlib + cdylib) — the cdylib
	// type triggers passthrough, but the rlib output is still consumed by
	// downstream crates compiled through the proxy.
	maybe_write_passthrough_externs(args);

	let error = std::process::Command::new(&args.rustc)
		.args(std::env::args().skip(2))
		.exec();
	Err(tg::error!("exec failed: {error}."))
}

/// Write a .externs sidecar file for a crate compiled in passthrough mode.
///
/// Crates with mixed crate types (e.g., `["lib", "cdylib"]`) are passthrough'd
/// because they need the host linker for the cdylib/dylib output. However, they
/// also produce rlib output that downstream proxy crates depend on. Without an
/// .externs file, `process_dependencies` cannot traverse through these crates
/// during the BFS transitive closure computation, causing downstream proxy crates
/// to miss transitive dependencies.
///
/// This function extracts the `-C extra-filename=` flag from the rustc args to
/// determine the output filename, then writes the .externs file before exec.
fn maybe_write_passthrough_externs(args: &args::Args) {
	// Only write .externs for crates that produce tracked output and have extern deps.
	// This includes proc-macro crates, which produce dylib output that downstream
	// crates depend on. Without .externs for proc-macros, the BFS transitive closure
	// cannot traverse through them, causing fallback to scanning all deps.
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

	// Extract -C extra-filename=<suffix> from the remaining args.
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

	// Construct the .externs filename to match the rlib output.
	let externs_filename = format!("lib{}{}.externs", args.crate_name, extra_filename);
	let externs_path = std::path::Path::new(output_dir).join(externs_filename);

	// Compute extern stems using the same format as write_outputs_to_cargo.
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
