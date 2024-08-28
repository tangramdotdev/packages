use std::{path::PathBuf, str::FromStr as _};

use itertools::Itertools as _;
use tangram_client as tg;
use tangram_std::{manifest, Manifest};

fn main() {
	// Setup tracing.
	#[cfg(feature = "tracing")]
	tangram_std::tracing::setup("TANGRAM_STRIP_PROXY_TRACING");

	if let Err(e) = main_inner() {
		eprintln!("strip proxy failed: {e}");
		eprintln!("{}", e.trace(&tg::error::TraceOptions::default()));
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
	if options.passthrough || options.strip_target.is_none() {
		#[cfg(feature = "tracing")]
		tracing::info!("passing through, running strip with unmodified arguments");
		run_strip(
			&options.strip_program,
			&options.strip_args,
			options.strip_target.as_deref(),
		)?;
		return Ok(());
	}

	// Read the target file. If it is not a Tangram wrapper, pass through the arguments to strip unchanged.
	// At this point, we know the target is a wrapper. Read the manifest.
	let target_path = options.strip_target.unwrap(); // This unwrap is safe, it was checked previously.
	let manifest = manifest::Manifest::read(&target_path).map_err(|error| {
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
		run_strip(
			&options.strip_program,
			&options.strip_args,
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
			&options.strip_program,
			&options.strip_args,
			&target_path,
			manifest,
			options.wrapper_id,
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

async fn run_proxy(
	strip_program: &std::path::Path,
	strip_args: &[String],
	target_path: &std::path::Path,
	manifest: Manifest,
	wrapper_id: tg::file::Id,
) -> tg::Result<()> {
	// Get the executable symlink data from the manifest.
	if let manifest::Executable::Path(symlink_data) = manifest.executable {
		// Create the tangram instance.
		let tg = tg::Client::with_env()?;
		tg.connect().await?;

		#[cfg(feature = "tracing")]
		tracing::info!(?symlink_data, "found executable symlink data");

		// Get the path to the actual executable.
		let executable_path = symlink_data_to_pathbuf(symlink_data);

		#[cfg(feature = "tracing")]
		tracing::info!(?executable_path, "found executable path");

		// Copy the file to the working directory.
		let cwd = std::env::current_dir().map_err(|error| {
			tg::error!(source = error, "could not get current working directory")
		})?;
		let local_executable_path = cwd.join("executable");
		tokio::fs::copy(&executable_path, &local_executable_path)
			.await
			.map_err(|error| tg::error!(source = error, "failed to copy the executable"))?;

		// Call strip with the correct arguments on the executable.
		run_strip(strip_program, strip_args, Some(&local_executable_path))?;
		#[cfg(feature = "tracing")]
		tracing::info!("strip succeeded");

		// Check in the result.
		let stripped_file = tg::Artifact::check_in(
			&tg,
			tg::artifact::checkin::Arg {
				destructive: false,
				path: local_executable_path.clone().try_into()?,
			},
		)
		.await?
		.try_unwrap_file()
		.map_err(|error| tg::error!(source = error, "expected a file"))?;
		let stripped_file_id = stripped_file.id(&tg).await?;
		#[cfg(feature = "tracing")]
		tracing::info!(?stripped_file_id, "checked in the stripped executable");

		// Produce a new manifest with the stripped executable, and the rest of the manifest unchanged.
		let new_manifest = Manifest {
			executable: manifest::Executable::Path(tg::symlink::Data {
				artifact: Some(stripped_file_id.into()),
				path: None,
			}),
			..manifest
		};
		#[cfg(feature = "tracing")]
		tracing::info!(?new_manifest, "created new manifest");
		let references = new_manifest
			.references()
			.into_iter()
			.map(tg::Artifact::with_id)
			.collect_vec();

		// Obtain the wrapper contents blob.
		let wrapper = tg::File::with_id(wrapper_id.clone());
		let wrapper_contents = wrapper.contents(&tg).await?;
		let wrapper_size = wrapper_contents.size(&tg).await?;

		// Serialize the manifest.
		let mut manifest = serde_json::to_vec(&new_manifest)
			.map_err(|error| tg::error!(source = error, "failed to serialize the manifest"))?;

		// Add three 64-bit values (manifest length, version, magic number).
		manifest.reserve_exact(3 * std::mem::size_of::<u64>());
		let suffix = u64::try_from(manifest.len())
			.unwrap()
			.to_le_bytes()
			.into_iter()
			.chain(tangram_std::manifest::VERSION.to_le_bytes().into_iter())
			.chain(tangram_std::manifest::MAGIC_NUMBER.iter().copied());
		manifest.extend(suffix);

		// Create the manifest blob.
		let manifest = std::io::Cursor::new(manifest);
		let manifest_blob = tg::Blob::with_reader(&tg, manifest).await?;
		let manifest_size = manifest_blob.size(&tg).await?;

		// Create a new blob with the wrapper contents and the manifest, keeping the wrapper in a separate blob.
		let output_blob = tg::Blob::new(vec![
			tg::branch::Child {
				blob: wrapper_contents,
				size: wrapper_size,
			},
			tg::branch::Child {
				blob: manifest_blob,
				size: manifest_size,
			},
		]);

		// Create a file with the new blob and references.
		let new_wrapper = tg::File::builder(output_blob)
			.executable(true)
			.references(references.into_iter().map(Into::into).collect_vec())
			.build();

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

		tg::Artifact::from(new_wrapper)
			.check_out(
				&tg,
				tg::artifact::checkout::Arg {
					bundle: false,
					force: true,
					path: Some(canonical_target_path.try_into()?),
					references: false,
				},
			)
			.await?;
		#[cfg(feature = "tracing")]
		tracing::info!("checked out the new output file");
	} else {
		#[cfg(feature = "tracing")]
		tracing::warn!("found a content executable. passing through, but this is probably an error and likely to fail");
		// If the executable is not a path, pass through the arguments to strip unchanged.
		run_strip(strip_program, strip_args, Some(target_path))?;
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

	/// The actual file being stripped.
	strip_target: Option<PathBuf>,

	/// The actual `strip` program to run.
	strip_program: PathBuf,

	/// Any paths required by the strip program at runtime.
	strip_runtime_library_path: Option<String>,

	/// The path to the wrapper.
	wrapper_id: tg::file::Id,
}

impl Options {
	fn parse() -> tg::Result<Self> {
		// Read env for options.
		let mut passthrough = std::env::var("TANGRAM_STRIP_PROXY_PASSTHROUGH").is_ok();
		let strip_program = std::env::var("TANGRAM_STRIP_COMMAND_PATH")
			.map_err(|error| tg::error!(source = error, "TANGRAM_STRIP_COMMAND_PATH not set"))?
			.into();
		let strip_runtime_library_path =
			std::env::var("TANGRAM_STRIP_RUNTIME_LIBRARY_PATH").unwrap_or_default();
		let strip_runtime_library_path = if strip_runtime_library_path.is_empty() {
			None
		} else {
			Some(strip_runtime_library_path)
		};

		// Get the wrapper path.
		let wrapper_id =
			tg::file::Id::from_str(&std::env::var("TANGRAM_STRIP_WRAPPER_ID").map_err(
				|error| tg::error!(source = error, "TANGRAM_STRIP_WRAPPER_ID must be set"),
			)?)
			.map_err(|error| tg::error!(source = error, "Could not parse wrapper ID"))?;

		// Parse the arguments.
		let mut strip_target = None;
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
					// If we haven't set the target yet, it's the target file.
					if strip_target.is_none() {
						strip_target = Some(arg.into());
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
			strip_args,
			strip_target,
			strip_program,
			strip_runtime_library_path,
			wrapper_id,
		};
		Ok(options)
	}
}

/// Execute the underlying `strip` command with the given arguments and optional target.
fn run_strip(
	strip_program: &std::path::Path,
	strip_args: &[String],
	target: Option<&std::path::Path>,
) -> tg::Result<()> {
	// Set up command.
	let mut command = std::process::Command::new(strip_program);
	command.args(strip_args);

	// If there is a target, add it to the command.
	if let Some(target) = target {
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

fn symlink_data_to_pathbuf(data: tg::symlink::Data) -> std::path::PathBuf {
	// Start from the artifact path.
	let mut path = std::path::PathBuf::from_str(&tangram_std::CLOSEST_ARTIFACT_PATH).unwrap();

	// Add the artifact path if it exists.
	if let Some(artifact_id) = data.artifact {
		path.push(artifact_id.to_string());
	}

	// Add the path if it exists.
	if let Some(subpath) = data.path {
		path.push(subpath);
	}

	path
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
	std::env::set_var(var_name, path);

	current_value
}
