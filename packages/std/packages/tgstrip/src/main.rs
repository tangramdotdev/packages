use {
	common::{Manifest, manifest},
	proxy::options::{Declaration, Kind, Session, Source, Value},
	std::{
		ffi::OsString,
		os::unix::fs::PermissionsExt,
		path::{Path, PathBuf},
	},
	tangram_client::prelude::*,
};

const DECLARATIONS: &[Declaration<()>] = &[Declaration {
	id: (),
	kind: Kind::Boolean,
	suffix: "passthrough",
}];

fn main() {
	// Setup tracing.
	#[cfg(feature = "tracing")]
	common::tracing::setup("TANGRAM_STRIP_TRACING");

	if let Err(e) = main_inner() {
		common::error::print_error(e);
		std::process::exit(1);
	}
}

fn main_inner() -> tg::Result<()> {
	let options = Options::parse()?;
	#[cfg(feature = "tracing")]
	tracing::info!(?options, "parsed options");

	tg::init()?;

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
		run_strip(&options.strip_program, &options.command_args)?;
		return Ok(());
	}

	// Identify wrapper occurrences without moving their positions in the argument vector.
	let mut wrappers = Vec::new();
	for index in &options.strip_targets {
		let path = Path::new(&options.command_args[*index]);
		if read_manifest(path)?.is_some() {
			wrappers.push(*index);
		}
	}

	// Re-read each wrapper after the previous job, including repeated paths and symlink aliases.
	if !wrappers.is_empty() {
		tokio::runtime::Builder::new_current_thread()
			.enable_all()
			.build()
			.unwrap()
			.block_on(async {
				for index in &wrappers {
					let path = Path::new(&options.command_args[*index]);
					let manifest = read_manifest(path)?
						.ok_or_else(|| tg::error!("expected a wrapper manifest"))?;
					run_proxy(&options, *index, path, manifest).await?;
				}
				Ok::<(), tg::Error>(())
			})?;
	}

	// Retain non-wrapper targets in their original positions, including duplicates.
	if wrappers.len() != options.strip_targets.len() {
		let args = options
			.command_args
			.iter()
			.enumerate()
			.filter(|(index, _)| wrappers.binary_search(index).is_err())
			.map(|(_, arg)| arg.clone())
			.collect::<Vec<_>>();
		run_strip(&options.strip_program, &args)?;
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
	options: &Options,
	target_index: usize,
	target_path: &Path,
	mut manifest: Manifest,
) -> tg::Result<()> {
	if matches!(&manifest.executable, manifest::Executable::Path(_)) {
		// The bytes contain IDs only. Recover the wrapper's authorized dependencies before rebuilding it.
		let path = std::path::absolute(target_path)
			.map_err(|error| tg::error!(!error, "invalid wrapper path"))?;
		let output = tg::checkin(tg::checkin::Arg {
			options: tg::checkin::Options {
				destructive: false,
				deterministic: true,
				ignore: false,
				lock: None,
				root: true,
				..tg::checkin::Options::default()
			},
			path,
			updates: Vec::new(),
		})
		.await?;
		let file = tg::Artifact::with_referent(output.artifact)
			.try_unwrap_file()
			.map_err(|error| tg::error!(!error, "expected a wrapper file"))?;
		manifest.resolve_from_file(&file).await?;
	}

	// Handle the executable based on its type.
	match manifest.executable {
		manifest::Executable::Path(artifact_path) => {
			#[cfg(feature = "tracing")]
			tracing::info!(?artifact_path, "found executable artifact path");

			// Get the path to the actual executable.
			let executable_path = artifact_path
				.try_render(|component| async move {
					match component {
						tg::template::Component::String(string) => Ok(string.clone()),
						tg::template::Component::Artifact(artifact) => {
							common::checkout_artifact(artifact.clone())
								.await?
								.into_os_string()
								.into_string()
								.map_err(|_| tg::error!("checkout path is not UTF-8"))
						},
						tg::template::Component::Placeholder(_) => {
							Err(tg::error!("cannot render an unresolved placeholder"))
						},
					}
				})
				.await
				.map(std::path::PathBuf::from)
				.map_err(|error| {
					tg::error!(!error, ?artifact_path, "unable to render executable path")
				})?;

			#[cfg(feature = "tracing")]
			tracing::info!(?executable_path, "found executable path");

			// Copy the file to a temp directory.
			#[cfg(target_os = "linux")]
			let tmpdir = tempfile::TempDir::new_in("/")
				.map_err(|error| tg::error!(!error, "failed to create tempdir"))?;
			#[cfg(target_os = "macos")]
			let tmpdir = tempfile::TempDir::new()
				.map_err(|error| tg::error!(!error, "failed to create tempdir"))?;
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
				.map_err(|error| tg::error!(!error, path = %local_executable_path.display(), "failed to get the file metadata"))?.permissions();
			perms.set_mode(perms.mode() | 0o200);
			tokio::fs::set_permissions(&local_executable_path, perms)
				.await
				.map_err(|error| tg::error!(!error, path = %local_executable_path.display(), "failed to set file permissions"))?;

			// Call strip with the correct arguments on the executable.
			let args = options.wrapper_args(target_index, &local_executable_path);
			run_strip(&options.strip_program, &args)?;
			#[cfg(feature = "tracing")]
			tracing::info!(?local_executable_path, "strip succeeded");

			// Check in the result.
			let output = tg::checkin(tg::checkin::Arg {
				options: tg::checkin::Options {
					source_dependencies: true,
					destructive: false,
					deterministic: true,
					ignore: false,
					locked: false,
					lock: Some(tg::checkin::Lock::Attr),
					root: true,
					..tg::checkin::Options::default()
				},
				path: local_executable_path,
				updates: vec![],
			})
			.await?;
			let stripped_file = tg::Artifact::with_referent(output.artifact)
				.try_unwrap_file()
				.map_err(|error| tg::error!(source = error, "expected a file"))?;
			#[cfg(feature = "tracing")]
			tracing::info!(stripped_file_id = ?stripped_file.id(), "checked in the stripped executable");

			#[cfg(feature = "tracing")]
			if let Err(e) = tmpdir.close() {
				tracing::warn!(?e, "failed to close tempdir");
			}
			#[cfg(not(feature = "tracing"))]
			let _ = tmpdir.close();

			// Produce a new manifest with the stripped executable, and the rest of the manifest unchanged.
			let new_manifest = Manifest {
				executable: manifest::Executable::Path(common::template_from_artifact(
					stripped_file.into(),
				)),
				..manifest
			};
			#[cfg(feature = "tracing")]
			tracing::info!(?new_manifest, "created new manifest");

			let new_wrapper = new_manifest.write().await?;
			new_wrapper.store().await?;
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

			let artifact = tg::Artifact::from(new_wrapper);
			common::checkout_artifact_to_path(artifact, canonical_target_path).await?;
			#[cfg(feature = "tracing")]
			tracing::info!("checked out the new output file");
		},
		manifest::Executable::Address(_address) => {
			#[cfg(feature = "tracing")]
			tracing::info!(
				?target_path,
				"found address executable (embedded wrapper), skipping strip to preserve manifest"
			);
		},
		manifest::Executable::Content(_) => {
			#[cfg(feature = "tracing")]
			tracing::warn!(
				"found a content executable. passing through, but this is probably an error and likely to fail"
			);

			// If the executable is content, pass through the arguments to strip unchanged.
			let args = options.wrapper_args(target_index, target_path);
			run_strip(&options.strip_program, &args)?;
		},
	}

	Ok(())
}

#[derive(Debug)]
struct Options {
	/// The original arguments excluding owned controls.
	command_args: Vec<OsString>,
	/// Whether to skip wrapper rewriting.
	passthrough: bool,
	/// The actual strip executable.
	strip_program: PathBuf,
	/// The library path required by strip at runtime.
	strip_runtime_library_path: Option<String>,
	/// Target occurrence indices in the filtered argument vector.
	strip_targets: Vec<usize>,
}

impl Options {
	fn parse() -> tg::Result<Self> {
		Self::parse_with_args(std::env::args_os().skip(1), |name| std::env::var_os(name))
	}

	fn parse_with_args(
		args: impl Iterator<Item = OsString>,
		mut lookup: impl FnMut(&str) -> Option<OsString>,
	) -> tg::Result<Self> {
		let strip_program = lookup("TANGRAM_STRIP_COMMAND_PATH")
			.ok_or_else(|| tg::error!("TANGRAM_STRIP_COMMAND_PATH must be set"))?
			.into();
		let strip_runtime_library_path = lookup("TANGRAM_STRIP_RUNTIME_LIBRARY_PATH")
			.and_then(|value| value.into_string().ok())
			.filter(|value| !value.is_empty());
		let mut session = Session::new("strip", DECLARATIONS, false, lookup, apply)?;
		let mut command_args = Vec::new();
		let mut strip_targets = Vec::new();
		for arg in args {
			let ended = session.ended();
			if session.consume(&arg)? {
				continue;
			}
			if ended || !arg.as_encoded_bytes().starts_with(b"-") {
				strip_targets.push(command_args.len());
			}
			command_args.push(arg);
		}
		let passthrough = session.into_settings();
		let options = Self {
			command_args,
			passthrough,
			strip_program,
			strip_runtime_library_path,
			strip_targets,
		};
		Ok(options)
	}

	fn wrapper_args(&self, target_index: usize, executable: &Path) -> Vec<OsString> {
		self.command_args
			.iter()
			.enumerate()
			.filter_map(|(index, arg)| {
				if index == target_index {
					Some(executable.as_os_str().to_owned())
				} else if self.strip_targets.binary_search(&index).is_ok() {
					None
				} else {
					Some(arg.clone())
				}
			})
			.collect()
	}
}

#[allow(clippy::unnecessary_wraps)]
fn apply(passthrough: &mut bool, (): (), value: Value<'_>, _: &Source) -> tg::Result<()> {
	let Value::Boolean(value) = value else {
		unreachable!("the declaration specifies a boolean");
	};
	*passthrough = value;
	Ok(())
}

fn read_manifest(path: &Path) -> tg::Result<Option<Manifest>> {
	Manifest::read_from_path(path).map_err(|error| {
		tg::error!(
			source = error,
			"could not read the manifest from {}",
			path.display()
		)
	})
}

/// Execute strip with the complete filtered argument vector.
fn run_strip(strip_program: &Path, args: &[OsString]) -> tg::Result<()> {
	let status = std::process::Command::new(strip_program)
		.args(args)
		.status()
		.map_err(|error| tg::error!(source = error, "could not run strip"))?;
	if !status.success() {
		return Err(tg::error!("strip failed with status: {}", status));
	}
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

#[cfg(test)]
mod tests;
