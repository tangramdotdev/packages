use std::{os::unix::fs::PermissionsExt, path::PathBuf};

use tangram_client::prelude::*;
use tangram_std::{Manifest, manifest};

fn main() {
	// Setup tracing.
	#[cfg(feature = "tracing")]
	tangram_std::tracing::setup("TGSTRIP_TRACING");

	if let Err(e) = main_inner() {
		eprintln!("strip proxy failed: {e}");
		std::process::exit(1);
	}
}

fn main_inner() -> tg::Result<()> {
	let options = Options::parse()?;
	#[cfg(feature = "tracing")]
	tracing::info!(?options, "parsed options");

	// Set the runtime library path.
	let original_runtime_library_path =
		if let Some(runtime_library_path) = &options.strip_runtime_library_path {
			set_runtime_library_path(runtime_library_path)
		} else {
			None
		};

	// Determine if we should skip the proxy and pass through the arguments to strip unchanged.
	if options.passthrough || options.strip_targets.is_empty() {
		#[cfg(feature = "tracing")]
		tracing::info!("passing through, running strip with unmodified arguments");
		let target_refs: Vec<&std::path::Path> =
			options.strip_targets.iter().map(|p| p.as_path()).collect();
		run_strip(&options.strip_program, &options.strip_args, &target_refs)?;
		return Ok(());
	}

	// Separate wrappers from non-wrappers.
	let mut wrappers = Vec::new();
	let mut non_wrappers = Vec::new();

	for target_path in &options.strip_targets {
		let manifest = manifest::Manifest::read_from_path(target_path).map_err(|error| {
			tg::error!(
				source = error,
				"could not read manifest from path: {}",
				target_path.display()
			)
		})?;

		if let Some(manifest) = manifest {
			#[cfg(feature = "tracing")]
			tracing::info!(?target_path, "found wrapper, will process with proxy");
			wrappers.push((target_path.clone(), manifest));
		} else {
			#[cfg(feature = "tracing")]
			tracing::info!(?target_path, "not a wrapper, will pass through to strip");
			non_wrappers.push(target_path);
		}
	}

	// Process all wrappers.
	if !wrappers.is_empty() {
		tokio::runtime::Builder::new_multi_thread()
			.enable_all()
			.build()
			.unwrap()
			.block_on(async {
				for (target_path, manifest) in wrappers {
					run_proxy(&options.strip_program, &options.strip_args, &target_path, manifest)
						.await?;
				}
				Ok::<(), tg::Error>(())
			})?;
	}

	// Process all non-wrappers in one batch.
	if !non_wrappers.is_empty() {
		let non_wrapper_refs: Vec<&std::path::Path> =
			non_wrappers.iter().map(|p| p.as_path()).collect();
		run_strip(
			&options.strip_program,
			&options.strip_args,
			&non_wrapper_refs,
		)?;
	}

	// Reset the runtime library path.
	if let Some(original_runtime_library_path) = original_runtime_library_path {
		#[cfg(feature = "tracing")]
		tracing::info!(
			?original_runtime_library_path,
			"resetting runtime library path"
		);
		set_runtime_library_path(&original_runtime_library_path);
	}

	Ok(())
}

#[allow(clippy::too_many_lines)]
async fn run_proxy(
	strip_program: &std::path::Path,
	strip_args: &[String],
	target_path: &std::path::Path,
	manifest: Manifest,
) -> tg::Result<()> {
	// Get the executable path from the manifest.
	if let manifest::Executable::Path(artifact_path) = manifest.executable {
		// Create the tangram instance.
		let tg = tg::Client::with_env()?;
		tg.connect().await?;

		#[cfg(feature = "tracing")]
		tracing::info!(?artifact_path, "found executable artifact path");

		// Get the path to the actual executable.
		let executable_path =
			std::path::PathBuf::from(tangram_std::render_template_data(&artifact_path).map_err(
				|source| tg::error!(!source, ?artifact_path, "unable to render executable path"),
			)?);

		#[cfg(feature = "tracing")]
		tracing::info!(?executable_path, "found executable path");

		// Copy the file to a temp directory.
		#[cfg(target_os = "linux")]
		let tmpdir = tempfile::TempDir::new_in("/")
			.map_err(|source| tg::error!(!source, "failed to create tempdir"))?;
		#[cfg(target_os = "macos")]
		let tmpdir = tempfile::TempDir::new()
			.map_err(|source| tg::error!(!source, "failed to create tempdir"))?;
		let tmp_path = tmpdir.path();
		let local_executable_path = tmp_path.join("executable");
		#[cfg(feature = "tracing")]
		tracing::info!(?local_executable_path, "copying the executable");

		tokio::fs::copy(&executable_path, &local_executable_path)
			.await
			.map_err(|error| tg::error!(source = error, "failed to copy the executable"))?;

		// Set the file to be writable.
		let mut perms = tokio::fs::metadata(&local_executable_path)
			.await
			.map_err(|source| tg::error!(!source, %path = local_executable_path.display(), "failed to get the file metadata"))?.permissions();
		perms.set_mode(perms.mode() | 0o200);
		tokio::fs::set_permissions(&local_executable_path, perms)
			.await
			.map_err(|source| tg::error!(!source, %path = local_executable_path.display(), "failed to set file permissions"))?;

		// Call strip with the correct arguments on the executable.
		run_strip(strip_program, strip_args, &[&local_executable_path])?;
		#[cfg(feature = "tracing")]
		tracing::info!(?local_executable_path, "strip succeeded");

		// Check in the result.
		let stripped_file = tg::checkin(
			&tg,
			tg::checkin::Arg {
				options: tg::checkin::Options {
					local_dependencies: true,
					destructive: false,
					deterministic: true,
					ignore: false,
					locked: false,
					lock: false,
					..tg::checkin::Options::default()
				},
				path: local_executable_path,
				updates: vec![],
			},
		)
		.await?
		.try_unwrap_file()
		.map_err(|error| tg::error!(source = error, "expected a file"))?;
		let stripped_file_id = stripped_file.id();
		#[cfg(feature = "tracing")]
		tracing::info!(?stripped_file_id, "checked in the stripped executable");

		#[cfg(feature = "tracing")]
		if let Err(e) = tmpdir.close() {
			tracing::warn!(?e, "failed to close tempdir");
		}
		#[cfg(not(feature = "tracing"))]
		let _ = tmpdir.close();

		// Produce a new manifest with the stripped executable, and the rest of the manifest unchanged.
		let new_manifest = Manifest {
			executable: manifest::Executable::Path(
				tangram_std::template_from_artifact(tg::Artifact::with_id(stripped_file_id.into()))
					.to_data(),
			),
			..manifest
		};
		#[cfg(feature = "tracing")]
		tracing::info!(?new_manifest, "created new manifest");

		let new_wrapper = new_manifest.write(&tg).await?;
		new_wrapper.store(&tg).await?;
		#[cfg(feature = "tracing")]
		{
			let new_wrapper_id = new_wrapper.id();
			tracing::info!(?new_wrapper_id, "wrote new wrapper");
		}

		// Check out the new output file.
		let canonical_target_path = std::fs::canonicalize(target_path).map_err(|error| {
			tg::error!(
				source = error,
				"could not get canonical path for the output file"
			)
		})?;
		#[cfg(feature = "tracing")]
		tracing::info!(?canonical_target_path, "checking out the new output file");

		// Remove the existing file.
		tokio::fs::remove_file(&canonical_target_path)
			.await
			.map_err(|error| tg::error!(source = error, "failed to remove the output file"))?;

		let artifact = tg::Artifact::from(new_wrapper).id();
		tg::checkout(
			&tg,
			tg::checkout::Arg {
				artifact,
				dependencies: false,
				force: true,
				path: Some(canonical_target_path),
				lock: true,
			},
		)
		.await?;
		#[cfg(feature = "tracing")]
		tracing::info!("checked out the new output file");
	} else {
		#[cfg(feature = "tracing")]
		tracing::warn!(
			"found a content executable. passing through, but this is probably an error and likely to fail"
		);
		// If the executable is not a path, pass through the arguments to strip unchanged.
		run_strip(strip_program, strip_args, &[target_path])?;
		return Ok(());
	}

	Ok(())
}

#[derive(Debug)]
struct Options {
	/// Should we skip the proxy and pass through the arguments to strip unchanged?
	passthrough: bool,

	/// Arguments to pass to strip.
	strip_args: Vec<String>,

	/// The actual files being stripped.
	strip_targets: Vec<PathBuf>,

	/// The actual `strip` program to run.
	strip_program: PathBuf,

	/// Any paths required by the strip program at runtime.
	strip_runtime_library_path: Option<String>,
}

impl Options {
	fn parse() -> tg::Result<Self> {
		// Read env for options.
		let mut passthrough = std::env::var("TGSTRIP_PASSTHROUGH").is_ok();
		let strip_program = std::env::var("TGSTRIP_COMMAND_PATH")
			.map_err(|error| tg::error!(source = error, "TGSTRIP_COMMAND_PATH not set"))?
			.into();
		let strip_runtime_library_path =
			std::env::var("TGSTRIP_RUNTIME_LIBRARY_PATH").unwrap_or_default();
		let strip_runtime_library_path = if strip_runtime_library_path.is_empty() {
			None
		} else {
			Some(strip_runtime_library_path)
		};

		// Parse the arguments.
		let mut strip_targets = Vec::new();
		let mut strip_args = vec![];

		for arg in std::env::args().skip(1) {
			// Catch any --tg- args.
			if arg.starts_with("--tg-") {
				// Handle --tg-passthrough.
				if arg == "--tg-passthrough" {
					passthrough = true;
				}
			} else {
				// If the argument starts with `-`, it's an argument to strip.
				if arg.starts_with('-') {
					strip_args.push(arg);
				} else {
					// This is a target file to strip.
					strip_targets.push(arg.into());
				}
			}
		}

		// Construct options struct.
		let options = Options {
			passthrough,
			strip_args,
			strip_targets,
			strip_program,
			strip_runtime_library_path,
		};
		Ok(options)
	}
}

/// Execute the underlying `strip` command with the given arguments and targets.
fn run_strip(
	strip_program: &std::path::Path,
	strip_args: &[String],
	targets: &[&std::path::Path],
) -> tg::Result<()> {
	#[cfg(feature = "tracing")]
	tracing::info!(?strip_program, ?strip_args, ?targets, "starting run_strip");

	// Set up command.
	let mut command = std::process::Command::new(strip_program);
	command.args(strip_args);

	// Add all targets to the command.
	for target in targets {
		command.arg(target);
	}

	// Wait for the command to finish.
	let status = command
		.status()
		.map_err(|error| tg::error!(source = error, "could not run strip"))?;

	// If the command failed, return an error.
	if !status.success() {
		return Err(tg::error!("strip failed with status: {}", status));
	}

	// Otherwise, return success.
	Ok(())
}

/// Set the correct environment variable for the runtime library path. Returns the current value if set.
fn set_runtime_library_path(path: &str) -> Option<String> {
	#[cfg(feature = "tracing")]
	tracing::info!(?path, "setting runtime library path");

	if path.is_empty() {
		#[cfg(feature = "tracing")]
		tracing::warn!("runtime library path is empty, not setting");
		return None;
	}

	let var_name = if cfg!(target_os = "macos") {
		"DYLD_FALLBACK_LIBRARY_PATH"
	} else if cfg!(target_os = "linux") {
		"LD_LIBRARY_PATH"
	} else {
		unreachable!("unsupported target OS")
	};

	// Grab the current value of the variable.
	let current_value = std::env::var(var_name).ok();

	// Set the new value.
	unsafe { std::env::set_var(var_name, path) };

	current_value
}
