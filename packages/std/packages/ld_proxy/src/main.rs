use futures::{StreamExt as _, TryStreamExt as _};
use itertools::Itertools;
use std::{
	collections::{BTreeMap, HashMap, HashSet},
	hash::BuildHasher,
	path::PathBuf,
	str::FromStr,
};
use tangram_client as tg;
use tokio::io::AsyncReadExt as _;

type Hasher = fnv::FnvBuildHasher;

const MAX_DEPTH: usize = 16;

fn main() {
	if let Err(e) = main_inner() {
		eprintln!("linker proxy failed: {e}");
		tracing::error!(
			"{}",
			e.trace(&tg::error::TraceOptions {
				internal: true,
				reverse: false,
			})
		);
		std::process::exit(1);
	}
}

fn main_inner() -> tg::Result<()> {
	// Read the options from the environment and arguments.
	let options = read_options()?;
	tangram_std::tracing::setup("TANGRAM_LD_PROXY_TRACING");
	tracing::debug!(?options);

	// Run the command.
	let status = std::process::Command::new(&options.command_path)
		.args(&options.command_args)
		.status()
		.map_err(|error| tg::error!(source = error, "failed to run the command"))?;

	// If the command did not exit successfully, then exit with its code.
	if !status.success() {
		let code = status.code().unwrap_or(1);
		std::process::exit(code);
	}

	// If passthrough mode is enabled, then exit.
	if options.passthrough {
		tracing::info!("Passthrough mode enabled. Exiting.");
		return Ok(());
	}

	// If there is no file with the output path name, then exit.
	if !options.output_path.exists() {
		tracing::info!("No output file found. Exiting.");
		return Ok(());
	}

	// Create the wrapper.
	tokio::runtime::Builder::new_multi_thread()
		.enable_all()
		.build()
		.unwrap()
		.block_on(create_wrapper(&options))?;

	Ok(())
}

// The options read from the environment and arguments.
#[derive(Debug)]
struct Options {
	/// Paths which may contain additional dynamic libraries passed on the command line, not via a library path.
	additional_library_candidate_paths: Vec<PathBuf>,

	/// Library path optimization strategy. Select `resolve`, `filter`, `combine`, or `none`. Defaults to `combine`.
	library_path_optimization: LibraryPathOptimizationLevel,

	/// The path to the command that will be invoked.
	command_path: PathBuf,

	/// The original arguments to the command.
	command_args: Vec<String>,

	/// The interpreter used by the output executable.
	interpreter_path: Option<String>,

	/// Any additional arguments to pass to the interpreter.
	interpreter_args: Option<Vec<String>>,

	/// The path to the injection library.
	injection_path: Option<String>,

	/// The library paths.
	library_paths: Vec<String>,

	/// The maximum number of transitive library path searches to perform during optimization. Defaults to 16.
	max_depth: usize,

	/// The output path.
	output_path: PathBuf,

	/// Whether the linker should run in passthrough mode.
	passthrough: bool,
}

// Read the options from the environment and arguments.
#[allow(clippy::too_many_lines)]
fn read_options() -> tg::Result<Options> {
	// Create the output.
	let mut command_args = Vec::new();
	let mut output_path = None;
	let mut library_paths = Vec::new();

	// Get the command.
	let command_path = std::env::var("TANGRAM_LINKER_COMMAND_PATH")
		.map_err(|error| tg::error!(source = error, "TANGRAM_LINKER_COMMAND_PATH must be set."))?
		.into();

	// Get the passthrough flag.
	let mut passthrough = std::env::var("TANGRAM_LINKER_PASSTHROUGH").is_ok();

	// Get the interpreter path.
	let interpreter_path = std::env::var("TANGRAM_LINKER_INTERPRETER_PATH")
		.ok()
		.map(Into::into);

	// Get additional interpreter args, if any.
	let interpreter_args = std::env::var("TANGRAM_LINKER_INTERPRETER_ARGS")
		.ok()
		.map(|combined| {
			combined
				.split_whitespace()
				.map(std::string::ToString::to_string)
				.collect_vec()
		});

	// Get the max depth.
	let mut max_depth = std::env::var("TANGRAM_LINKER_MAX_DEPTH")
		.ok()
		.map_or(MAX_DEPTH, |s| s.parse().unwrap_or(MAX_DEPTH));

	// Get the injection path.
	let injection_path = std::env::var("TANGRAM_LINKER_INJECTION_PATH").ok();

	// Get the option to disable combining library paths. Enabled by default.
	let mut library_optimization_strategy = std::env::var("TANGRAM_LINKER_LIBRARY_PATH_OPT_LEVEL")
		.ok()
		.map_or(LibraryPathOptimizationLevel::default(), |s| {
			s.parse().unwrap_or_default()
		});

	// Get an iterator over the arguments.
	let mut args = std::env::args();

	// Skip arg0.
	args.next();

	// Prepare to store dynamic libraries passed directly to the linker.
	let mut additional_library_candidate_paths = Vec::new();

	// Handle the arguments.
	while let Some(arg) = args.next() {
		// Pass through any arg that isn't a tangram arg.
		if arg.starts_with("--tg-") {
			// Handle setting combined library paths. Will override the env var if set.
			if arg.starts_with("--tg-library-path-opt-level=") {
				let option = arg.strip_prefix("--tg-library-path-opt-level=").unwrap();
				library_optimization_strategy =
					LibraryPathOptimizationLevel::from_str(option).unwrap_or_default();
			} else if arg.starts_with("--tg-max-depth=") {
				let option = arg.strip_prefix("--tg-max-depth=").unwrap();
				if let Ok(max_depth_arg) = option.parse() {
					max_depth = max_depth_arg;
				} else {
					tracing::warn!("Invalid max depth argument {option}. Using default.");
				}
			} else if arg.starts_with("--tg-passthrough") {
				passthrough = true;
			} else {
				command_args.push(arg.clone());
			}
		} else {
			command_args.push(arg.clone());
		}

		// Handle the output path argument.
		if arg == "-o" || arg == "--output" {
			if let Some(path) = args.next() {
				command_args.push(path.clone());
				output_path = path.into();
			}
		} else if let Some(output_arg) = arg.strip_prefix("-o") {
			output_path = Some(output_arg.into());
		} else if let Some(output_arg) = arg.strip_prefix("--output=") {
			output_path = Some(output_arg.into());
		}

		// Handle the library path argument.
		if arg == "-L" || arg == "--library_path" {
			if let Some(library_path) = args.next() {
				library_paths.push(library_path);
			}
		} else if let Some(library_arg) = arg.strip_prefix("--library-path=") {
			library_paths.push(library_arg.to_owned());
		} else if let Some(library_path) = arg.strip_prefix("-L") {
			library_paths.push(library_path.to_owned());
		}

		// Add any dynamic libraries passed directly to the linker.
		if is_library_candidate(&arg) {
			// If the path can't be canonicalized, do nothing - it's not a valid library candidate.
			if let Ok(canonical_path) = std::fs::canonicalize(&arg) {
				additional_library_candidate_paths.push(canonical_path);
			}
		}
	}

	// If no explicit output path was provided, instead look for `a.out`.
	let output_path = output_path.as_deref().unwrap_or("a.out").into();

	let options = Options {
		additional_library_candidate_paths,
		library_path_optimization: library_optimization_strategy,
		command_path,
		command_args,
		interpreter_path,
		interpreter_args,
		injection_path,
		library_paths,
		max_depth,
		output_path,
		passthrough,
	};

	Ok(options)
}

#[allow(clippy::too_many_lines)]
async fn create_wrapper(options: &Options) -> tg::Result<()> {
	// Create the tangram instance.
	let tg = tg::Client::with_env()?;
	tg.connect().await?;
	let tg_url = tg.url();
	tracing::debug!(?tg_url, "connected client");

	// Analyze the output file.
	let AnalyzeOutputFileOutput {
		is_executable,
		interpreter,
		name,
		needed_libraries: initial_needed_libraries,
	} = analyze_output_file(&options.output_path).await?;
	tracing::debug!(?is_executable, ?interpreter, ?initial_needed_libraries);

	// If the file is executable but does not need an interpreter, it is static or static-PIE linked. Abort here.
	if is_executable && matches!(interpreter, InterpreterRequirement::None) {
		tracing::info!("No interpreter needed for static executable. Exiting without wrapping.");
		return Ok(());
	}

	// Set the initially known needed libraries. This map will track which library path contains each needed library.
	let mut needed_libraries: HashMap<String, Option<tg::Referent<tg::directory::Id>>, Hasher> =
		initial_needed_libraries
			.iter()
			.map(|name| (name.clone(), None))
			.collect();

	// On macOS, retain only filenames and remove the "self" and "libSystem.B.dylib" entries.
	if cfg!(target_os = "macos") {
		needed_libraries.retain(|key, _| {
			!key.contains("self")
				&& !key.contains("libSystem.B.dylib")
				&& if let Some(name) = &name {
					!key.contains(name)
				} else {
					true
				}
		});
	}

	// Create a library path for any additional candidate libraries that are found in NEEDED and are actual library files.
	let command_line_library_path = create_library_directory_for_command_line_libraries(
		&tg,
		&options.additional_library_candidate_paths,
		&mut needed_libraries,
	)
	.await?;

	// Unrender all library paths to symlinks. If any library path points into the working directory, check in its contents.
	let library_paths = command_line_library_path
		.into_iter()
		.chain(
			futures::future::try_join_all(options.library_paths.iter().map(|library_path| async {
				let symlink_data = tangram_std::template_data_to_symlink_data(
					tangram_std::unrender(library_path)?.data(&tg).await?,
				)?;
				let artifact_path = match symlink_data.clone() {
					tg::symlink::data::Symlink::Artifact {
						artifact: artifact_id,
						subpath,
					} => {
						tracing::debug!(?artifact_id, ?subpath, "checking for entries");
						let artifact = tg::Artifact::with_id(artifact_id.clone());
						if let Ok(directory) = artifact.try_unwrap_directory() {
							let entries = if let Some(ref subpath) = subpath {
								if let Ok(subdirectory) =
									directory.get(&tg, &subpath).await?.try_unwrap_directory()
								{
									subdirectory.entries(&tg).await?
								} else {
									BTreeMap::default()
								}
							} else {
								directory.entries(&tg).await?
							};
							if entries.is_empty() {
								None
							} else {
								tracing::debug!(
									?artifact_id,
									?subpath,
									"found a directory with entries"
								);
								let referent =
									dir_id_referent_from_directory(&tg, &directory, subpath)
										.await?;
								Some(referent)
							}
						} else {
							None
						}
					},
					tg::symlink::data::Symlink::Target { target } => {
						tracing::debug!(
							"Library path points into working directory: {:?}. Creating directory.",
							target
						);
						if let Ok(ref canonicalized_path) = std::fs::canonicalize(&target) {
							checkin_local_library_path(&tg, canonicalized_path).await?
						} else {
							tracing::warn!(
								"Could not canonicalize library path {target:?}. Skipping."
							);
							None
						}
					},
					tg::symlink::data::Symlink::Graph { .. } => {
						tracing::warn!(?symlink_data, "ecountered a graph object");
						None
					},
				};
				Ok::<_, tg::Error>(artifact_path)
			}))
			.await?
			.into_iter()
			.flatten(),
		)
		.collect_vec();
	tracing::debug!(?library_paths, "Library paths");

	// Obtain the file artifact from the output path.
	let output_file = {
		// Check in the output file.
		let output_path = std::fs::canonicalize(&options.output_path)
			.map_err(|error| tg::error!(source = error, "cannot canonicalize output path"))?;
		tracing::debug!(?output_path, "about to check in output file");
		tg::Artifact::check_in(
			&tg,
			tg::artifact::checkin::Arg {
				destructive: false,
				deterministic: true,
				ignore: false,
				locked: false,
				path: output_path,
			},
		)
		.await?
		.try_unwrap_file()
		.map_err(|error| tg::error!(source = error, "expected a file"))?
	};
	let output_file_id = output_file.id(&tg).await?;
	tracing::debug!(?output_file_id, "checked in output file");

	let library_paths = if library_paths.is_empty() {
		None
	} else {
		let library_paths: HashSet<tg::Referent<tg::directory::Id>, Hasher> =
			library_paths.into_iter().collect();

		let strategy = options.library_path_optimization;
		tracing::trace!(
			?library_paths,
			?needed_libraries,
			?strategy,
			"pre-optimize library paths"
		);

		let library_paths = optimize_library_paths(
			&tg,
			&output_file,
			library_paths,
			&mut needed_libraries,
			options.library_path_optimization,
			options.max_depth,
		)
		.await?;

		tracing::trace!(
			?library_paths,
			?needed_libraries,
			?strategy,
			"post-optimize library paths"
		);

		Some(library_paths)
	};

	// Handle an executable or a library.
	let output_file = if is_executable {
		// Obtain the output artifact ID.
		let output_artifact_id = output_file.id(&tg).await?.clone().into();

		// Create the manifest.
		let manifest =
			create_manifest(&tg, output_artifact_id, options, interpreter, library_paths).await?;
		tracing::trace!(?manifest);

		// Write the manifest to a wrapper.
		let new_wrapper = manifest.write(&tg).await?;
		let new_wrapper_id = new_wrapper.id(&tg).await?;
		tracing::trace!(?new_wrapper_id);

		// Create a file with the new blob and references.
		Some(new_wrapper)
	} else {
		// If the linker generated a library, then add the library paths to its references.
		if library_paths.is_some() {
			let dependencies = BTreeMap::from_iter(
				futures::future::try_join_all(library_paths.unwrap().into_iter().map(
					|referent| async {
						let key = tg::Reference::with_object(&referent.item.clone().into());
						let value = tg::Referent {
							item: tg::Directory::with_id(referent.item).into(),
							subpath: referent.subpath,
							path: referent.path,
							tag: referent.tag,
						};
						Ok::<_, tg::Error>((key, value))
					},
				))
				.await?,
			);
			let output_file_contents = output_file.contents(&tg).await?;
			// NOTE - in practice, `output_file_executable` will virtually always be false in this branch, but we don't want to lose the information if the caller is doing something fancy.
			let output_file_executable = output_file.executable(&tg).await?;
			Some(
				tg::File::builder(output_file_contents)
					.executable(output_file_executable)
					.dependencies(dependencies)
					.build(),
			)
		} else {
			None
		}
	};

	if let Some(output_file) = output_file {
		// Remove the existing file.
		tokio::fs::remove_file(&options.output_path)
			.await
			.map_err(|error| tg::error!(source = error, "failed to remove the output file"))?;

		// Check out the new output file.
		let cwd = std::env::current_dir()
			.map_err(|error| tg::error!(source = error, "failed to get the current directory"))?;
		let output_path = cwd.join(&options.output_path);
		let output_file_id = output_file.id(&tg).await?;
		tracing::debug!(?output_file_id, ?output_path, "checking out output file");
		tg::Artifact::from(output_file)
			.check_out(
				&tg,
				tg::artifact::checkout::Arg {
					force: true,
					path: Some(output_path),
				},
			)
			.await?;
	}

	Ok(())
}

/// Check in any files needed libraries and produce a directory with correct names.
async fn checkin_local_library_path(
	tg: &impl tg::Handle,
	library_path: &impl AsRef<std::path::Path>,
) -> tg::Result<Option<tg::Referent<tg::directory::Id>>> {
	let library_path = library_path.as_ref();
	tracing::debug!(?library_path, "Checking in local library path");
	// Get a stream of directory entries.
	let read_dir = tokio::fs::read_dir(library_path)
		.await
		.map_err(|error| tg::error!(source = error, "could not read library path"))?;
	let stream = tokio_stream::wrappers::ReadDirStream::new(read_dir);

	// Produce checked-in directory entries for all libraries found.
	let entries = stream
		.map(|entry| async {
			let entry = entry.map_err(|error| {
				tg::error!(source = error, "could not read next directory entry")
			})?;

			let library_candidate_path = entry.path();
			tracing::debug!(?library_candidate_path, "analyzing library candidate path");

			// Skip any entry we cannot determine is a regular file.
			let metadata = tokio::fs::symlink_metadata(&library_candidate_path).await;
			if metadata.is_err() || !metadata.unwrap().is_file() {
				tracing::debug!("Skipping non-file entry.");
				return Ok(None);
			}

			if let Ok(AnalyzeOutputFileOutput {
				name: Some(name), ..
			}) = analyze_output_file(&library_candidate_path).await
			{
				tracing::debug!(?name, "Found library candidate.");
				// Check in the file.
				let library_candidate_file = tg::Artifact::check_in(
					tg,
					tg::artifact::checkin::Arg {
						destructive: false,
						deterministic: true,
						ignore: false,
						locked: false,
						path: library_candidate_path,
					},
				)
				.await?
				.try_unwrap_file()
				.map_err(|error| tg::error!(source = error, "expected a file"))?;

				// Add an entry to the directory.
				tracing::info!(?library_candidate_file, "Checked in library candidate.");
				Ok::<_, tg::Error>(Some((name, tg::Artifact::File(library_candidate_file))))
			} else {
				Ok(None)
			}
		})
		.filter_map(|result| async { result.await.transpose() })
		.try_collect::<BTreeMap<_, _>>()
		.await?;

	let result = if entries.is_empty() {
		None
	} else {
		let directory = tg::Directory::with_entries(entries);
		let referent = dir_id_referent_from_directory(tg, &directory, None).await?;
		Some(referent)
	};
	Ok(result)
}

fn extract_filename(path: &(impl AsRef<str> + ToString + ?Sized)) -> String {
	std::path::Path::new(path.as_ref()).file_name().map_or_else(
		|| path.to_string(),
		|name| name.to_string_lossy().to_string(),
	)
}

/// Create a manifest.
async fn create_manifest<H: BuildHasher>(
	tg: &impl tg::Handle,
	ld_output_id: tg::artifact::Id,
	options: &Options,
	interpreter: InterpreterRequirement,
	library_paths: Option<HashSet<tg::Referent<tg::directory::Id>, H>>,
) -> tg::Result<tangram_std::Manifest> {
	// Create the interpreter.
	let interpreter = {
		let config = match interpreter {
			InterpreterRequirement::Default(flavor) => {
				let path = options
					.interpreter_path
					.as_ref()
					.expect("TANGRAM_LINKER_INTERPRETER_PATH must be set.");

				Some((path.clone(), flavor))
			},
			InterpreterRequirement::Path(path) => {
				let interpreter_flavor = determine_interpreter_flavor(&path).await?;

				Some((path, interpreter_flavor))
			},
			InterpreterRequirement::None => None,
		};
		tracing::trace!(?config, "Interpreter configuration");

		// Render the library paths.
		let library_paths = if let Some(library_paths) = library_paths {
			let result = futures::future::try_join_all(library_paths.into_iter().map(
				|referent| async move {
					let directory = directory_from_dir_id_referent(tg, &referent).await?;
					let template = tangram_std::template_from_artifact(directory.into());
					let data = template.data(tg).await?;
					Ok::<_, tg::Error>(data)
				},
			))
			.await?;
			Some(result)
		} else {
			None
		};
		tracing::trace!(?library_paths, "Library paths");

		if let Some((path, interpreter_flavor)) = config {
			// Unrender the interpreter path.
			let path = tangram_std::unrender(&path)?;
			let path = path.data(tg).await?;

			// Unrender the preloads.
			let mut preloads = None;
			if let Some(injection_path) = options.injection_path.as_deref() {
				preloads = Some(vec![tangram_std::unrender(injection_path)?.data(tg).await?]);
			}

			// Unrender the additional args.
			let mut args = None;
			if let Some(interpreter_args) = options.interpreter_args.as_deref() {
				let interpreter_args = interpreter_args
					.iter()
					.map(|arg| async move { tangram_std::unrender(arg)?.data(tg).await });
				args = Some(futures::future::try_join_all(interpreter_args).await?);
			}

			match interpreter_flavor {
				InterpreterFlavor::Dyld => Some(tangram_std::manifest::Interpreter::DyLd(
					tangram_std::manifest::DyLdInterpreter {
						library_paths,
						preloads,
					},
				)),
				InterpreterFlavor::Gnu => Some(tangram_std::manifest::Interpreter::LdLinux(
					tangram_std::manifest::LdLinuxInterpreter {
						path,
						library_paths,
						preloads,
						args,
					},
				)),
				InterpreterFlavor::Musl => Some(tangram_std::manifest::Interpreter::LdMusl(
					tangram_std::manifest::LdMuslInterpreter {
						path,
						library_paths,
						preloads,
						args,
					},
				)),
			}
		} else {
			// There was no interpreter specified. We are likely a statically linked executable.
			None
		}
	};

	// Create the executable.
	let executable = tangram_std::manifest::Executable::Path(
		tangram_std::template_from_artifact(tg::Artifact::with_id(ld_output_id))
			.data(tg)
			.await?,
	);

	// Create empty values for env and args.
	let env = None;
	let args = None;

	// Create the manifest.
	let manifest = tangram_std::Manifest {
		identity: tangram_std::manifest::Identity::Wrapper,
		interpreter,
		executable,
		env,
		args,
	};

	Ok(manifest)
}

struct AnalyzeOutputFileOutput {
	/// Is the output file executable?
	is_executable: bool,
	/// Does the output file need an interpreter? On macOS, This should always get `Some(None)`. On Linux, None indicates a statically-linked executable, `Some(None)` indicates a dynamically-linked executable with a default ldso path, and `Some(Some(symlink))` indicates the `PT_INTERP` field has been explicitly set to point at a non-standard path we need to retain.
	interpreter: InterpreterRequirement,
	/// The name of this library, if present. This is soname on Linux and name on macOS.
	name: Option<String>,
	/// Does the output file specify libraries required at runtime?
	needed_libraries: Vec<String>,
}

/// The possible interpreter requirements of an output file.
#[derive(Debug)]
enum InterpreterRequirement {
	/// There is no interpreter needed to execute this file.
	None,
	/// Use the system default interpreter to execute this file.
	Default(InterpreterFlavor),
	/// Use the interpreter at the given path to execute this file.
	Path(String),
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
enum LibraryPathOptimizationLevel {
	/// Do not optimize library paths.
	None = 0,
	/// Resolve any artifacts with subpaths to their innermost directory. The `Filter` and `Combine` strategies will also perform this optimization first.
	Resolve = 1,
	/// Filter library paths for needed libraries.
	Filter = 2,
	/// Combine library paths into a single directory.
	#[default]
	Combine = 3,
}

impl std::str::FromStr for LibraryPathOptimizationLevel {
	type Err = tg::Error;

	fn from_str(s: &str) -> Result<Self, Self::Err> {
		match s.to_ascii_lowercase().as_str() {
			"none" | "0" => Ok(Self::None),
			"resolve" | "1" => Ok(Self::Resolve),
			"filter" | "2" => Ok(Self::Filter),
			"combine" | "3" => Ok(Self::Combine),
			_ => {
				// If the string is a digit greater than 3, fall back to 3.
				if let Ok(level) = s.parse::<usize>() {
					if level > 3 {
						return Ok(Self::Combine);
					}
				}
				Err(tg::error!("invalid library path optimization strategy {s}"))
			},
		}
	}
}

/// Check in any files needed libraries and produce a directory with correct names, returning a referent.
async fn create_library_directory_for_command_line_libraries<H: BuildHasher>(
	tg: &impl tg::Handle,
	library_candidate_paths: &[PathBuf],
	all_needed_libraries: &mut HashMap<String, Option<tg::Referent<tg::directory::Id>>, H>,
) -> tg::Result<Option<tg::Referent<tg::directory::Id>>> {
	let mut entries = BTreeMap::new();
	for library_candidate_path in library_candidate_paths {
		if let Ok(AnalyzeOutputFileOutput {
			name: Some(name), ..
		}) = analyze_output_file(library_candidate_path).await
		{
			// Ensure the file is actually an object. If not, skip it.
			if all_needed_libraries.contains_key(&name) {
				// Check in the file.
				let library_candidate_file = tg::Artifact::check_in(
					tg,
					tg::artifact::checkin::Arg {
						destructive: false,
						deterministic: true,
						ignore: false,
						locked: false,
						path: library_candidate_path.clone(),
					},
				)
				.await?
				.try_unwrap_file()
				.map_err(|error| tg::error!(source = error, "expected a file"))?;

				// Add an entry to the directory.
				entries.insert(name, tg::Artifact::File(library_candidate_file));
			}
		}
	}

	let result = if entries.is_empty() {
		None
	} else {
		let directory = tg::Directory::with_entries(entries);
		let referent = dir_id_referent_from_directory(tg, &directory, None).await?;
		Some(referent)
	};
	Ok(result)
}

/// Determine whether the given argument should be considered a library candidate.
fn is_library_candidate(arg: &str) -> bool {
	let dylib_ext = if cfg!(target_os = "macos") {
		".dylib"
	} else if cfg!(target_os = "linux") {
		// Exclude interpreter paths.
		let is_ldso = arg.contains("ld-linux") || arg.contains("ld-musl");
		if is_ldso {
			return false;
		}
		".so"
	} else {
		unreachable!();
	};
	arg.contains(dylib_ext)
}

/// Produce the library paths for the output wrapper according to the given configuration.
async fn optimize_library_paths<H: BuildHasher + Default + Send + Sync>(
	tg: &impl tg::Handle,
	file: &tg::File,
	library_paths: HashSet<tg::Referent<tg::directory::Id>, H>,
	needed_libraries: &mut HashMap<String, Option<tg::Referent<tg::directory::Id>>, H>,
	strategy: LibraryPathOptimizationLevel,
	max_depth: usize,
) -> tg::Result<HashSet<tg::Referent<tg::directory::Id>, H>> {
	if matches!(strategy, LibraryPathOptimizationLevel::None) || library_paths.is_empty() {
		return Ok(library_paths);
	}

	// Resolve any artifacts with subpaths to their innermost directory.
	let resolved_dirs: HashSet<tg::Referent<tg::directory::Id>, H> =
		resolve_directories(tg, &library_paths).await?;
	tracing::trace!(?resolved_dirs, "post-resolve");
	if matches!(strategy, LibraryPathOptimizationLevel::Resolve) {
		return finalize_library_paths(tg, resolved_dirs, needed_libraries).await;
	}

	// Find all the transitive needed libraries of the output file we can locate in the library path.
	find_transitive_needed_libraries(tg, file, &resolved_dirs, needed_libraries, max_depth, 0)
		.await?;
	tracing::trace!(?needed_libraries, "post-find");
	if matches!(strategy, LibraryPathOptimizationLevel::Filter) {
		let resolved_dirs = needed_libraries.values().flatten().cloned().collect();
		return finalize_library_paths(tg, resolved_dirs, needed_libraries).await;
	}

	if !matches!(strategy, LibraryPathOptimizationLevel::Combine) {
		return Err(tg::error!(
			"invalid library path optimization strategy {strategy:?}"
		));
	}

	let mut entries = BTreeMap::new();
	for (name, dir_id_referent) in needed_libraries.iter() {
		if let Some(dir_id_referent) = dir_id_referent {
			let directory = directory_from_dir_id_referent(tg, dir_id_referent).await?;
			if let Ok(Some(artifact)) = directory.try_get(tg, &name).await {
				entries.insert(name.clone(), artifact);
			}
		}
	}
	let dir_id = if entries.is_empty() {
		None
	} else {
		let referent =
			dir_id_referent_from_directory(tg, &tg::Directory::with_entries(entries), None).await?;
		Some(referent)
	};
	let resolved_dirs = dir_id.into_iter().collect();

	finalize_library_paths(tg, resolved_dirs, needed_libraries).await
}

/// Produce the set of library paths to be written to the wrapper post-optimization.
async fn finalize_library_paths<H: BuildHasher + Default>(
	tg: &impl tg::Handle,
	resolved_dirs: HashSet<tg::Referent<tg::directory::Id>, H>,
	needed_libraries: &HashMap<String, Option<tg::Referent<tg::directory::Id>>, H>,
) -> tg::Result<HashSet<tg::Referent<tg::directory::Id>, H>> {
	futures::future::try_join_all(resolved_dirs.iter().map(|referent| async {
		let directory = directory_from_dir_id_referent(tg, referent).await?;
		let directory_id = directory.id(tg).await?;
		let arg = tg::artifact::checkout::Arg::default();
		tracing::debug!(?directory_id, ?arg, "checking out library path");
		tg::Artifact::from(directory).check_out(tg, arg).await?;
		Ok::<_, tg::Error>(())
	}))
	.await?;
	report_missing_libraries(tg, needed_libraries, &resolved_dirs).await?;
	Ok(resolved_dirs)
}

/// Given a list of needed library names and a set of selected paths, report which libraries are not accounted for.
async fn report_missing_libraries<H: BuildHasher + Default>(
	tg: &impl tg::Handle,
	needed_libraries: &HashMap<String, Option<tg::Referent<tg::directory::Id>>, H>,
	library_paths: &HashSet<tg::Referent<tg::directory::Id>, H>,
) -> tg::Result<()> {
	let mut found_libraries = HashSet::default();
	for library in needed_libraries.keys() {
		// For this check, we just care about the basename.
		let library_basename = library.split('.').next().ok_or(tg::error!(
			"could not determine basename for library {library}"
		))?;
		for library_path in library_paths {
			let directory = directory_from_dir_id_referent(tg, library_path).await?;
			for needed_library_name in directory.entries(tg).await?.keys() {
				if needed_library_name.starts_with(library_basename) {
					found_libraries.insert(needed_library_name.to_string());
					break;
				}
			}
		}
	}
	let needed_library_names = needed_libraries.keys().cloned().collect::<HashSet<_, H>>();
	let missing_libs = needed_library_names
		.difference(&found_libraries)
		.collect_vec();
	if !missing_libs.is_empty() {
		tracing::warn!(
			?library_paths,
			"Could not find the following required libraries: {missing_libs:?}"
		);
	}
	Ok(())
}

/// Given a set of referents which may contain subpaths, return referents with the item resolved to the inner directory.
async fn resolve_directories<H: BuildHasher + Default>(
	tg: &impl tg::Handle,
	unresolved_paths: &HashSet<tg::Referent<tg::directory::Id>, H>,
) -> tg::Result<HashSet<tg::Referent<tg::directory::Id>, H>> {
	let resolved_paths =
		futures::future::try_join_all(unresolved_paths.iter().cloned().map(|referent| async {
			let resolved_referent = if let Some(subpath) = referent.subpath {
				let directory = tg::Directory::with_id(referent.item.clone());
				let Some(inner) = directory.try_get(tg, &subpath).await? else {
					return Err(
						tg::error!(%directory = referent.item, %subpath = subpath.display(), "unable to retrieve subpath from directory"),
					);
				};
				let inner = inner.try_unwrap_directory().map_err(|source| tg::error!(!source, %outer = referent.item, %subpath = subpath.display(), "expected a directory"))?;
				dir_id_referent_from_directory(tg, &inner, None).await?
			} else {
				referent
			};
			Ok::<_, tg::Error>(resolved_referent)
		}))
		.await?
		.into_iter()
		.collect::<HashSet<_, H>>();
	Ok(resolved_paths)
}

/// Recursively find all needed libraries for an executable.
async fn find_transitive_needed_libraries<H: BuildHasher + Default + Send + Sync>(
	tg: &impl tg::Handle,
	file: &tg::File,
	library_paths: &HashSet<tg::Referent<tg::directory::Id>, H>,
	all_needed_libraries: &mut HashMap<String, Option<tg::Referent<tg::directory::Id>>, H>,
	max_depth: usize,
	depth: usize,
) -> tg::Result<()> {
	// Check if we're done.
	if found_all_libraries(all_needed_libraries) || depth == max_depth {
		return Ok(());
	}

	// Check for transitive dependencies if we've recurred beyond the initial file.
	if depth > 0 {
		let AnalyzeOutputFileOutput {
			needed_libraries, ..
		} = analyze_executable(&file.bytes(tg).await?)?;
		for library in &needed_libraries {
			all_needed_libraries.entry(library.clone()).or_insert(None);
		}
	}

	for referent in library_paths {
		let directory = directory_from_dir_id_referent(tg, referent).await?;
		tracing::trace!(?referent, "Checking directory for libraries.");
		let copy = all_needed_libraries.keys().cloned().collect_vec();
		for library_name in copy {
			if all_needed_libraries
				.get(&library_name)
				.unwrap_or(&None)
				.is_some()
			{
				continue;
			}
			tracing::info!(?library_name, "checking for library");
			if let Ok(Some(tg::artifact::Handle::File(found_library))) =
				directory.try_get(tg, &library_name).await
			{
				let found_library_id = found_library.id(tg).await?;
				tracing::trace!(?found_library_id, ?library_name, "Found library file.");
				*all_needed_libraries
					.entry(library_name.clone())
					.or_insert(None) = Some(referent.clone());
				Box::pin(find_transitive_needed_libraries(
					tg,
					&found_library,
					library_paths,
					all_needed_libraries,
					max_depth,
					depth + 1,
				))
				.await?;
				if found_all_libraries(all_needed_libraries) {
					return Ok(());
				}
			};
		}
	}

	Ok(())
}

/// Determine if all needed libraries have been found.
#[tracing::instrument]
fn found_all_libraries<H: BuildHasher + Default>(
	all_needed_libraries: &HashMap<String, Option<tg::Referent<tg::directory::Id>>, H>,
) -> bool {
	all_needed_libraries.is_empty() || all_needed_libraries.values().all(Option::is_some)
}

/// Analyze an output file.
async fn analyze_output_file(
	path: impl AsRef<std::path::Path>,
) -> tg::Result<AnalyzeOutputFileOutput> {
	let bytes = bytes_from_path(path).await?;
	analyze_executable(&bytes)
}

/// The supported flavors of interpreter.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum InterpreterFlavor {
	Dyld,
	Gnu,
	Musl,
}

/// Determine the flavor of the `ld-linux.so` executable at the given path, if it is one.
async fn determine_interpreter_flavor(
	path: impl AsRef<std::path::Path>,
) -> tg::Result<InterpreterFlavor> {
	let path = path.as_ref();
	let path = std::fs::canonicalize(path).map_err(|error| {
		tg::error!(
			source = error,
			"failed to canonicalize path {}",
			path.display()
		)
	})?;

	let bytes = bytes_from_path(path).await?;

	let object = goblin::Object::parse(&bytes)
		.map_err(|error| tg::error!(source = error, "failed to parse output file as an object"))?;
	if let goblin::Object::Elf(elf) = object {
		let flavor = if elf.soname.is_some() && elf.soname.unwrap().starts_with("ld-linux") {
			InterpreterFlavor::Gnu
		} else {
			InterpreterFlavor::Musl
		};
		Ok(flavor)
	} else {
		Err(tg::error!("unsupported object type, expected elf file"))
	}
}

/// Analyze an executable.
fn analyze_executable(bytes: &[u8]) -> tg::Result<AnalyzeOutputFileOutput> {
	// Parse the object and analyze it.
	let object = goblin::Object::parse(bytes)
		.map_err(|error| tg::error!(source = error, "failed to parse output file as an object"))?;
	let result = match object {
		// Handle an archive file.
		goblin::Object::Archive(_) => AnalyzeOutputFileOutput {
			is_executable: false,
			interpreter: InterpreterRequirement::None,
			name: None,
			needed_libraries: vec![],
		},

		// Handle an ELF file.
		goblin::Object::Elf(elf) => {
			// Read the elf's dynamic sections to determine if this is a PIE.
			let is_pie = elf.dynamic.is_some_and(|d| {
				d.info.flags_1 & goblin::elf::dynamic::DF_1_PIE == goblin::elf::dynamic::DF_1_PIE
			});

			// Read the ELF header to determine if it is an executable.
			let is_executable = !elf.is_lib || is_pie;

			let name = elf.soname.map(std::string::ToString::to_string);

			let needed_libraries = elf
				.libraries
				.iter()
				.map(std::string::ToString::to_string)
				.collect_vec();

			// Check whether or not the object requires an interpreter:
			// - If the object has an interpreter field.
			// - If the object is a PIE and has 1 or more NEEDS.
			let interpreter =
				if elf.interpreter.is_some() || (is_pie && !needed_libraries.is_empty()) {
					let interpreter = elf.interpreter.unwrap();
					if interpreter.starts_with("/lib") {
						if interpreter.contains("musl") {
							InterpreterRequirement::Default(InterpreterFlavor::Musl)
						} else {
							InterpreterRequirement::Default(InterpreterFlavor::Gnu)
						}
					} else {
						// If a path not in /lib is specified, then we need to retain it.
						InterpreterRequirement::Path(interpreter.to_owned())
					}
				} else {
					InterpreterRequirement::None
				};

			AnalyzeOutputFileOutput {
				is_executable,
				interpreter,
				name,
				needed_libraries,
			}
		},

		// Handle a Mach-O file.
		goblin::Object::Mach(mach) => match mach {
			goblin::mach::Mach::Binary(mach) => {
				let is_executable = mach.header.filetype == goblin::mach::header::MH_EXECUTE;
				let name = mach.name.map(extract_filename);
				let needed_libraries = mach.libs.iter().map(extract_filename).collect_vec();

				AnalyzeOutputFileOutput {
					is_executable,
					interpreter: InterpreterRequirement::Default(InterpreterFlavor::Dyld),
					name,
					needed_libraries,
				}
			},
			goblin::mach::Mach::Fat(mach) => {
				let (is_executable, name, needed_libraries) = mach
					.into_iter()
					.filter_map(std::result::Result::ok)
					.fold((false, None, vec![]), |acc, arch| match arch {
						goblin::mach::SingleArch::Archive(_) => (true, None, acc.2),
						goblin::mach::SingleArch::MachO(mach) => {
							let acc_executable = acc.0;
							let mut libs = acc.2;
							let executable = acc_executable
								|| (mach.header.filetype == goblin::mach::header::MH_EXECUTE);
							libs.extend(mach.libs.iter().map(extract_filename));
							let name = mach.name.map(extract_filename);
							(executable, name, libs)
						},
					});
				AnalyzeOutputFileOutput {
					is_executable,
					interpreter: InterpreterRequirement::Default(InterpreterFlavor::Dyld),
					name,
					needed_libraries,
				}
			},
		},

		_ => return Err(tg::error!("unsupported object type")),
	};

	Ok(result)
}

/// Read the bytes from a file at the given path.
async fn bytes_from_path(path: impl AsRef<std::path::Path>) -> tg::Result<Vec<u8>> {
	let mut reader =
		tokio::io::BufReader::new(tokio::fs::File::open(&path).await.map_err(|error| {
			tg::error!(
				source = error,
				r#"failed to open the file at path "{}""#,
				path.as_ref().display()
			)
		})?);

	let mut bytes = Vec::new();
	reader
		.read_to_end(&mut bytes)
		.await
		.map_err(|error| tg::error!(source = error, "failed to read the output file"))?;

	Ok(bytes)
}

/// Get a [`tg::Directory`] handle from a [`tg::Referent<tg::directory::Id>`]. If there is a subpath present, returns the inner directory.
pub async fn directory_from_dir_id_referent(
	tg: &impl tg::Handle,
	referent: &tg::Referent<tg::directory::Id>,
) -> tg::Result<tg::Directory> {
	let outer = tg::Directory::with_id(referent.item.clone());
	let directory = if let Some(ref subpath) = referent.subpath {
		let Some(inner) = outer.try_get(tg, subpath).await? else {
			return Err(
				tg::error!(%directory = referent.item, %subpath = subpath.display(), "unable to retrieve subpath from directory"),
			);
		};
		inner.try_unwrap_directory().map_err(|source| tg::error!(!source, %outer = referent.item, %subpath = subpath.display(), "expected a directory"))?
	} else {
		outer
	};
	Ok(directory)
}

/// Get a [`tg::Referent<tg::directory::Id>`] from a [`tg::Directory`] handle.
pub async fn dir_id_referent_from_directory(
	tg: &impl tg::Handle,
	directory: &tg::Directory,
	subpath: Option<PathBuf>,
) -> tg::Result<tg::Referent<tg::directory::Id>> {
	let item = directory.id(tg).await?;
	let referent = tg::Referent {
		item,
		subpath,
		path: None,
		tag: None,
	};
	Ok(referent)
}

#[cfg(test)]
mod tests {
	use super::{analyze_output_file, AnalyzeOutputFileOutput, InterpreterRequirement};

	#[tokio::test]
	async fn read_output_files() {
		std::fs::write("main.c", "int main() { return 0; }").unwrap();

		// Test analyzing a shared library.
		std::process::Command::new("cc")
			.arg("main.c")
			.arg("-shared")
			.arg("-o")
			.arg("a.out")
			.status()
			.unwrap();
		let AnalyzeOutputFileOutput { is_executable, .. } =
			analyze_output_file("a.out").await.unwrap();
		assert!(
			!is_executable,
			"Dynamically linked library was detected as an executable."
		);

		// Test analyzing a dynamic executable with an interpreter.
		std::process::Command::new("cc")
			.arg("main.c")
			.arg("-o")
			.arg("a.out")
			.status()
			.unwrap();
		let AnalyzeOutputFileOutput {
			is_executable,
			interpreter,
			..
		} = analyze_output_file("a.out").await.unwrap();
		assert!(
			is_executable,
			"Dynamically linked executable was detected as a library."
		);
		assert!(
			!matches!(interpreter, InterpreterRequirement::None),
			"Dynamically linked executables need an interpreter."
		);

		// Test analyzing a statically linked executable.
		std::process::Command::new("cc")
			.arg("main.c")
			.arg("-static")
			.arg("-static-libgcc")
			.arg("-o")
			.arg("a.out")
			.status()
			.unwrap();
		let AnalyzeOutputFileOutput {
			is_executable,
			interpreter,
			..
		} = analyze_output_file("a.out").await.unwrap();
		assert!(
			is_executable,
			"Statically linked executable was detected as a library."
		);
		assert!(
			matches!(interpreter, InterpreterRequirement::None),
			"Statically linked executables do not need an interpreter."
		);

		// Test analyzing a static-pie executable.
		std::process::Command::new("cc")
			.arg("main.c")
			.arg("-pie")
			.arg("-o")
			.arg("a.out")
			.status()
			.unwrap();
		let AnalyzeOutputFileOutput {
			is_executable,
			interpreter,
			..
		} = analyze_output_file("a.out").await.unwrap();
		assert!(is_executable, "PIE was detected as a library.");
		assert!(
			!matches!(interpreter, InterpreterRequirement::None),
			"PIEs need an interpreter."
		);

		// Test analyzing a static-pie linked executable.
		std::process::Command::new("cc")
			.arg("main.c")
			.arg("-static-pie")
			.arg("-static-libgcc")
			.arg("-o")
			.arg("a.out")
			.status()
			.unwrap();
		let AnalyzeOutputFileOutput {
			is_executable,
			interpreter,
			..
		} = analyze_output_file("a.out").await.unwrap();
		assert!(
			is_executable,
			"Static-pie linked executable was detected as a library."
		);
		assert!(
			matches!(interpreter, InterpreterRequirement::None),
			"Static-PIE linked executables do not need an interpreter."
		);

		std::fs::remove_file("a.out").ok();
		std::fs::remove_file("main.c").ok();
	}
}
