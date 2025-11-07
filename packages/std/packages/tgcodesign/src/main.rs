use std::{os::unix::fs::PermissionsExt, path::PathBuf};

use tangram_client::prelude::*;
use tangram_std::{Manifest, manifest};

fn main() {
	// Setup tracing.
	#[cfg(feature = "tracing")]
	tangram_std::tracing::setup("TGCODESIGN_TRACING");

	if let Err(e) = main_inner() {
		eprintln!("codesign proxy failed: {e}");
		std::process::exit(1);
	}
}

fn main_inner() -> tg::Result<()> {
	let options = Options::parse()?;
	#[cfg(feature = "tracing")]
	tracing::info!(?options, "parsed options");

	// Set the runtime library path.
	let original_runtime_library_path =
		if let Some(runtime_library_path) = &options.codesign_runtime_library_path {
			set_runtime_library_path(runtime_library_path)
		} else {
			None
		};

	// Determine if we should skip the proxy and pass through the arguments to codesign unchanged.
	if options.passthrough || options.codesign_target.is_none() {
		#[cfg(feature = "tracing")]
		tracing::info!("passing through, running codesign with unmodified arguments");
		run_codesign(
			&options.codesign_program,
			&options.codesign_args,
			options.codesign_target.as_deref(),
		)?;
		return Ok(());
	}

	// Read the target file. If it is not a Tangram wrapper, pass through the arguments to codesign unchanged.
	// At this point, we know the target is a wrapper. Read the manifest.
	let target_path = options.codesign_target.unwrap(); // This unwrap is safe, it was checked previously.
	let manifest = manifest::Manifest::read_from_path(&target_path).map_err(|error| {
		tg::error!(
			source = error,
			"could not read manifest from path: {}",
			target_path.display()
		)
	})?;
	if manifest.is_none() {
		#[cfg(feature = "tracing")]
		tracing::warn!(
			"could not read manifest from path: {}, passing through",
			target_path.display()
		);
		run_codesign(
			&options.codesign_program,
			&options.codesign_args,
			Some(&target_path),
		)?;
		return Ok(());
	}
	let manifest = manifest.unwrap();

	// Run the proxy.
	tokio::runtime::Builder::new_multi_thread()
		.enable_all()
		.build()
		.unwrap()
		.block_on(run_proxy(
			&options.codesign_program,
			&options.codesign_args,
			&target_path,
			manifest,
		))?;

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
	codesign_program: &std::path::Path,
	codesign_args: &[String],
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

		// Call codesign with the correct arguments on the executable.
		run_codesign(codesign_program, codesign_args, Some(&local_executable_path))?;
		#[cfg(feature = "tracing")]
		tracing::info!(?local_executable_path, "codesign succeeded");

		// Check in the result.
		let codesigned_file = tg::checkin(
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
		let codesigned_file_id = codesigned_file.id();
		#[cfg(feature = "tracing")]
		tracing::info!(?codesigned_file_id, "checked in the codesigned executable");

		#[cfg(feature = "tracing")]
		if let Err(e) = tmpdir.close() {
			tracing::warn!(?e, "failed to close tempdir");
		}
		#[cfg(not(feature = "tracing"))]
		let _ = tmpdir.close();

		// Produce a new manifest with the codesigned executable, and the rest of the manifest unchanged.
		let new_manifest = Manifest {
			executable: manifest::Executable::Path(
				tangram_std::template_from_artifact(tg::Artifact::with_id(codesigned_file_id.into()))
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
		// If the executable is not a path, pass through the arguments to codesign unchanged.
		run_codesign(codesign_program, codesign_args, Some(target_path))?;
		return Ok(());
	}

	Ok(())
}

#[derive(Debug)]
struct Options {
	/// Should we skip the proxy and pass through the arguments to codesign unchanged?
	passthrough: bool,

	/// Arguments to pass to codesign.
	codesign_args: Vec<String>,

	/// The actual file being codesigned.
	codesign_target: Option<PathBuf>,

	/// The actual `codesign` program to run.
	codesign_program: PathBuf,

	/// Any paths required by the codesign program at runtime.
	codesign_runtime_library_path: Option<String>,
}

impl Options {
	fn parse() -> tg::Result<Self> {
		// Read env for options.
		let mut passthrough = std::env::var("TGCODESIGN_PASSTHROUGH").is_ok();
		let codesign_program = std::env::var("TGCODESIGN_COMMAND_PATH")
			.map_err(|error| tg::error!(source = error, "TGCODESIGN_COMMAND_PATH not set"))?
			.into();
		let codesign_runtime_library_path =
			std::env::var("TGCODESIGN_RUNTIME_LIBRARY_PATH").unwrap_or_default();
		let codesign_runtime_library_path = if codesign_runtime_library_path.is_empty() {
			None
		} else {
			Some(codesign_runtime_library_path)
		};

		// Parse the arguments.
		let mut codesign_target = None;
		let mut codesign_args = vec![];

		for arg in std::env::args().skip(1) {
			// Catch any --tg- args.
			if arg.starts_with("--tg-") {
				// Handle --tg-passthrough.
				if arg == "--tg-passthrough" {
					passthrough = true;
				}
			} else {
				// If the argument starts with `-`, it's an argument to codesign.
				if arg.starts_with('-') {
					codesign_args.push(arg);
				} else {
					// If we haven't set the target yet, it's the target file.
					if codesign_target.is_none() {
						codesign_target = Some(arg.into());
					} else {
						// If we have already set the target, it's an error.
						return Err(tg::error!("unexpected argument: {}", arg));
					}
				}
			}
		}

		// Construct options struct.
		let options = Options {
			passthrough,
			codesign_args,
			codesign_target,
			codesign_program,
			codesign_runtime_library_path,
		};
		Ok(options)
	}
}

/// Execute the underlying `codesign` command with the given arguments and optional target.
fn run_codesign(
	codesign_program: &std::path::Path,
	codesign_args: &[String],
	target: Option<&std::path::Path>,
) -> tg::Result<()> {
	#[cfg(feature = "tracing")]
	tracing::info!(?codesign_program, ?codesign_args, ?target, "starting run_codesign");

	// Set up command.
	let mut command = std::process::Command::new(codesign_program);
	command.args(codesign_args);

	// If there is a target, add it to the command.
	if let Some(target) = target {
		command.arg(target);
	}

	// Wait for the command to finish.
	let status = command
		.status()
		.map_err(|error| tg::error!(source = error, "could not run codesign"))?;

	// If the command failed, return an error.
	if !status.success() {
		return Err(tg::error!("codesign failed with status: {}", status));
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
