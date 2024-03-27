use futures::future::try_join_all;
use itertools::Itertools;
use std::{
	collections::{BTreeMap, HashMap, HashSet},
	hash::BuildHasher,
	os::unix::fs::PermissionsExt,
	path::PathBuf,
	str::FromStr,
};
use tangram_client as tg;
use tangram_error::{error, Result};
use tangram_wrapper::manifest::{self, Manifest};
use tokio::io::{AsyncRead, AsyncReadExt};
use tracing_subscriber::prelude::*;

type Hasher = fnv::FnvBuildHasher;

const MAX_DEPTH: usize = 16;

#[tokio::main]
async fn main() {
	if let Err(e) = main_inner().await {
		eprintln!("linker proxy failed: {e}");
		tracing::trace!("{}", e.trace(&tangram_error::TraceOptions::default()));
		std::process::exit(1);
	}
}

async fn main_inner() -> Result<()> {
	// Read the options from the environment and arguments.
	let options = read_options();
	setup_tracing(options.tracing_level.as_deref());
	tracing::debug!(?options);

	// Run the command.
	let status = std::process::Command::new(&options.command_path)
		.args(&options.command_args)
		.status()
		.map_err(|error| error!(source = error, "failed to run the command"))?;

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
	create_wrapper(&options).await?;

	Ok(())
}

// The options read from the environment and arguments.
#[derive(Debug)]
struct Options {
	/// Library path optimization strategy. Select `filter`, `combine`, or `none`. Defaults to `filter`.
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

	/// Tracing level.
	tracing_level: Option<String>,

	/// The path to the wrapper.
	wrapper_path: Option<PathBuf>,
}

// Read the options from the environment and arguments.
fn read_options() -> Options {
	// Create the output.
	let mut command_args = Vec::new();
	let mut output_path = None;
	let mut library_paths = Vec::new();

	// Get the command.
	let command_path = std::env::var("TANGRAM_LINKER_COMMAND_PATH")
		.ok()
		.map(Into::into)
		.expect("TANGRAM_LINKER_COMMAND_PATH must be set.");

	// Get the passthrough flag.
	let passthrough = std::env::var("TANGRAM_LINKER_PASSTHROUGH").is_ok();

	// Get the wrapper path.
	let wrapper_path = std::env::var("TANGRAM_LINKER_WRAPPER_PATH")
		.ok()
		.map(Into::into);

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

	// Get the tracing level if set.
	let tracing_level = std::env::var("TANGRAM_LD_PROXY_TRACING").ok();

	// Get an iterator over the arguments.
	let mut args = std::env::args();

	// Skip arg0.
	args.next();

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
	}

	// If no explicit output path was provided, instead look for `a.out`.
	let output_path = output_path.as_deref().unwrap_or("a.out").into();

	Options {
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
		tracing_level,
		wrapper_path,
	}
}

#[allow(clippy::too_many_lines)]
async fn create_wrapper(options: &Options) -> Result<()> {
	// Create the tangram instance.
	let tg = tg::Client::with_env()?;
	tg.connect().await?;

	// Analyze the output file.
	let AnalyzeOutputFileOutput {
		is_executable,
		interpreter,
		needed_libraries: initial_needed_libraries,
		..
	} = analyze_output_file(&options.output_path).await?;
	tracing::debug!(?is_executable, ?interpreter, ?initial_needed_libraries);

	// Unrender all library paths to symlinks.
	let library_paths = options
		.library_paths
		.iter()
		.map(|library_path| template_data_to_symlink_data(unrender(&tg, library_path)));
	let library_paths = futures::future::try_join_all(library_paths).await?;
	tracing::debug!(?library_paths);

	// We need to obtain an artifact if the file is executable or we are creating a combined library directory.
	let output_artifact = if is_executable
		|| !matches!(
			options.library_path_optimization,
			LibraryPathOptimizationLevel::None
		) {
		// Open the output file.
		let reader = tokio::io::BufReader::new(
			tokio::fs::File::open(&options.output_path)
				.await
				.map_err(|error| error!(source = error, "Could not open output file"))?,
		);
		let output_artifact = file_from_reader(&tg, reader, is_executable).await?;

		Some(output_artifact)
	} else {
		None
	};

	let library_paths = if library_paths.is_empty() {
		None
	} else {
		// Set the initially known needed libraries.
		let mut needed_libraries: HashMap<String, Option<tg::directory::Id>, Hasher> =
			initial_needed_libraries
				.iter()
				.cloned()
				.map(|name| (name, None))
				.collect();

		let library_paths: HashSet<tg::symlink::Id, Hasher> =
			futures::future::try_join_all(library_paths.into_iter().map(|symlink_data| async {
				let object = tg::symlink::Object::try_from(symlink_data).unwrap();
				let symlink = tg::Symlink::with_object(object);
				let id = symlink.id(&tg).await?;
				Ok::<_, tangram_error::Error>(id.clone())
			}))
			.await?
			.into_iter()
			.collect();
		let strategy = options.library_path_optimization;
		tracing::trace!(
			?library_paths,
			?needed_libraries,
			?strategy,
			"pre-optimize library paths"
		);

		// If any tracing level is set, enable verifying missing libraries.
		let report_missing = options.tracing_level.is_some();

		let library_paths = optimize_library_paths(
			&tg,
			&output_artifact,
			library_paths,
			&mut needed_libraries,
			options.library_path_optimization,
			report_missing,
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

	// Keep track of the references.
	let mut references: HashSet<tg::artifact::Id, Hasher> = HashSet::default();

	// Handle an executable or a library.
	if is_executable {
		let output_artifact = output_artifact.unwrap();
		let output_artifact_id = output_artifact.id(&tg).await?.clone().into();

		// Copy the wrapper to the temporary path.
		let wrapper_path = options
			.wrapper_path
			.as_ref()
			.ok_or(error!("TANGRAM_LINKER_WRAPPER_PATH must be set"))?;
		std::fs::remove_file(&options.output_path).ok();
		std::fs::copy(wrapper_path, &options.output_path)
			.map_err(|error| error!(source = error, "failed to copy the wrapper file"))?;

		// Set the permissions of the wrapper file so we can write the manifest to the end.
		let mut perms = std::fs::metadata(&options.output_path)
			.expect("failed to get the wrapper file metadata")
			.permissions();
		perms.set_mode(0o755);
		std::fs::set_permissions(&options.output_path, perms)
			.expect("failed to set the wrapper file permissions");

		let manifest =
			create_manifest(&tg, output_artifact_id, options, interpreter, library_paths).await?;
		tracing::trace!(?manifest);

		// Write the manifest.
		manifest
			.write(&options.output_path)
			.expect("Failed to write the manifest");

		// Get the manifest's references.
		references = manifest.references();
	} else {
		// Otherwise, if the linker generated a library, then add its references.
		if let Some(library_paths) = library_paths {
			references.reserve(library_paths.len());
			for library_path in &library_paths {
				references.insert(library_path.clone().into());
			}
		}
	}

	// Set the xattrs of the output file.
	tracing::trace!(?references, "Writing references");
	let attributes = tg::file::Attributes {
		references: references.into_iter().collect(),
	};
	let attributes =
		serde_json::to_string(&attributes).expect("Failed to serialize the attributes");
	xattr::set(&options.output_path, "user.tangram", attributes.as_bytes())
		.expect("Failed to write the attributes.");

	Ok(())
}

/// Create a manifest.
#[allow(clippy::too_many_lines)]
async fn create_manifest<H: BuildHasher>(
	tg: &dyn tg::Handle,
	ld_output_id: tg::artifact::Id,
	options: &Options,
	interpreter: InterpreterRequirement,
	library_paths: Option<HashSet<tg::symlink::Id, H>>,
) -> Result<Manifest> {
	// Create the interpreter.
	let interpreter = if cfg!(target_os = "linux") {
		let config = match interpreter {
			InterpreterRequirement::Default => {
				let path = options
					.interpreter_path
					.as_ref()
					.expect("TANGRAM_LINKER_INTERPRETER_PATH must be set.");
				let interpreter_flavor = determine_interpreter_flavor(path).await?;

				Some((path.clone(), interpreter_flavor))
			},
			InterpreterRequirement::Path(path) => {
				let interpreter_flavor = determine_interpreter_flavor(&path).await?;

				Some((path, interpreter_flavor))
			},
			InterpreterRequirement::None => None,
		};

		// Render the library paths.
		let library_paths = if let Some(library_paths) = library_paths {
			let result = futures::future::try_join_all(library_paths.into_iter().map(|id| async {
				let symlink = tg::Symlink::with_id(id);
				let data = symlink.data(tg).await?;
				Ok::<_, tangram_error::Error>(data)
			}))
			.await?;
			Some(result)
		} else {
			None
		};

		if let Some((path, interpreter_flavor)) = config {
			// Unrender the interpreter path.
			let path = unrender(tg, &path);
			let path = template_data_to_symlink_data(path).await?;
			tracing::trace!(?path, "Interpreter path");

			// Unrender the preloads.
			let mut preloads = None;
			if let Some(injection_path) = options.injection_path.as_deref() {
				preloads = Some(vec![
					template_data_to_symlink_data(unrender(tg, injection_path)).await?,
				]);
			}

			// Unrender the additional args.
			let mut args = None;
			if let Some(interpreter_args) = options.interpreter_args.as_deref() {
				let interpreter_args = interpreter_args.iter().map(|arg| unrender(tg, arg));
				args = Some(futures::future::join_all(interpreter_args).await);
			}

			match interpreter_flavor {
				LinuxInterpreterFlavor::Default => Some(manifest::Interpreter::LdLinux(
					manifest::LdLinuxInterpreter {
						path,
						library_paths,
						preloads,
						args,
					},
				)),
				LinuxInterpreterFlavor::Musl => {
					Some(manifest::Interpreter::LdMusl(manifest::LdMuslInterpreter {
						path,
						library_paths,
						preloads,
						args,
					}))
				},
			}
		} else {
			// There was no interpreter specified. We are likely a statically linked executable.
			None
		}
	} else if cfg!(target_os = "macos") {
		// Unrender the library paths.
		let library_paths = options
			.library_paths
			.iter()
			.map(|library_path| template_data_to_symlink_data(unrender(tg, library_path)));
		let library_paths = Some(futures::future::try_join_all(library_paths).await?);
		let mut preloads = None;
		if let Some(injection_path) = options.injection_path.as_deref() {
			preloads = Some(
				futures::future::try_join_all(std::iter::once(template_data_to_symlink_data(
					unrender(tg, injection_path),
				)))
				.await?,
			);
		}

		Some(manifest::Interpreter::DyLd(manifest::DyLdInterpreter {
			library_paths,
			preloads,
		}))
	} else {
		unreachable!();
	};

	// Create the executable.
	let executable = manifest::Executable::Path(tg::symlink::Data {
		artifact: Some(ld_output_id),
		path: None,
	});

	// Create empty values for env and args.
	let env = None;
	let args = None;

	// Create the manifest.
	let manifest = Manifest {
		identity: manifest::Identity::Wrapper,
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
	/// Does the output file need an interpreter? On macOS, This should always get `Some(None)`. On Linux, None indicates a statically-linked executable, `Some(None)` indicates a dynamically-linked executable with a default ldso path, and `Some(Some(symlink))` indicates the PT_INTERP field has been explicitly set to point at a non-standard path we need to retain.
	interpreter: InterpreterRequirement,
	/// Does the output file specify libraries required at runtime?
	needed_libraries: Vec<String>,
}

/// The possible interpreter requirements of an output file.
#[derive(Debug)]
enum InterpreterRequirement {
	/// There is no interpreter needed to execute this file.
	None,
	/// Use the system default interpreter to execute this file.
	Default,
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
	type Err = tangram_error::Error;

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
				Err(error!("invalid library path optimization strategy {s}"))
			},
		}
	}
}

#[tracing::instrument(skip(tg, file))]
async fn optimize_library_paths<H: BuildHasher + Default + Send + Sync>(
	tg: &dyn tg::Handle,
	file: &Option<tg::File>,
	library_paths: HashSet<tg::symlink::Id, H>,
	needed_libraries: &mut HashMap<String, Option<tg::directory::Id>, H>,
	strategy: LibraryPathOptimizationLevel,
	report_missing: bool,
	max_depth: usize,
) -> Result<HashSet<tg::symlink::Id, H>> {
	if file.is_none()
		|| matches!(strategy, LibraryPathOptimizationLevel::None)
		|| library_paths.is_empty()
	{
		return Ok(library_paths);
	}

	// Resolve any artifacts with subpaths to their innermost directory.
	let resolved_dirs: HashSet<tg::directory::Id, H> = resolve_paths(tg, &library_paths).await?;
	tracing::trace!(?resolved_dirs, "post-resolve");
	if matches!(strategy, LibraryPathOptimizationLevel::Resolve) {
		return finalize_library_paths(tg, resolved_dirs, needed_libraries, report_missing).await;
	}

	// Find all the transitive needed libraries of the output file we can locate in the library path.
	let file = file.as_ref().unwrap();
	find_transitive_needed_libraries(tg, file, &resolved_dirs, needed_libraries, max_depth, 0)
		.await?;
	tracing::trace!(?needed_libraries, "post-find");
	if matches!(strategy, LibraryPathOptimizationLevel::Filter) {
		let resolved_dirs = needed_libraries.values().flatten().cloned().collect();
		return finalize_library_paths(tg, resolved_dirs, needed_libraries, report_missing).await;
	}

	if !matches!(strategy, LibraryPathOptimizationLevel::Combine) {
		return Err(error!(
			"invalid library path optimization strategy {strategy:?}"
		));
	}

	let mut entries = BTreeMap::new();
	for (name, dir_id) in needed_libraries.iter() {
		if let Some(dir_id) = dir_id {
			let directory = tg::Directory::with_id(dir_id.clone());
			if let Ok(Some(artifact)) = directory.try_get(tg, &tg::Path::from_str(name)?).await {
				entries.insert(name.clone(), artifact);
			}
		}
	}
	let directory = tg::Directory::new(entries);
	let dir_id = directory.id(tg).await?;
	let resolved_dirs = std::iter::once(dir_id.clone()).collect();

	return finalize_library_paths(tg, resolved_dirs, needed_libraries, report_missing).await;
}

async fn finalize_library_paths<H: BuildHasher + Default>(
	tg: &dyn tg::Handle,
	resolved_dirs: HashSet<tg::directory::Id, H>,
	needed_libraries: &HashMap<String, Option<tg::directory::Id>, H>,
	report_missing: bool,
) -> Result<HashSet<tg::symlink::Id, H>> {
	let result = store_dirs_as_symlinks(tg, resolved_dirs).await?;
	if report_missing {
		report_missing_libraries(tg, needed_libraries, &result).await?;
	}
	Ok(result)
}

/// Given a list of needed library names and a set of selected paths, report which libraries are not accounted for.
async fn report_missing_libraries<H: BuildHasher + Default>(
	tg: &dyn tg::Handle,
	needed_libraries: &HashMap<String, Option<tg::directory::Id>, H>,
	library_paths: &HashSet<tg::symlink::Id, H>,
) -> Result<()> {
	let mut found_libraries = HashSet::default();
	for library in needed_libraries.keys() {
		for library_path in library_paths {
			let symlink = tg::Symlink::with_id(library_path.clone());
			let artifact = symlink
				.artifact(tg)
				.await?
				.as_ref()
				.ok_or(error!("expected a directory"))?;
			if let tg::Artifact::Directory(directory) = artifact {
				if directory.entries(tg).await?.contains_key(library) {
					found_libraries.insert(library.clone());
					continue;
				}
			}
		}
	}
	let needed_library_names = needed_libraries.keys().cloned().collect::<HashSet<_, H>>();
	let missing_libs = needed_library_names
		.difference(&found_libraries)
		.collect_vec();
	if !missing_libs.is_empty() {
		tracing::warn!("Could not find the following libraries, they will be required at runtime: {missing_libs:?}");
	}
	Ok(())
}

/// Given a set of symlink IDs, return any directory IDs we can find by resolving them.
async fn resolve_paths<H: BuildHasher + Default>(
	tg: &dyn tg::Handle,
	unresolved_paths: &HashSet<tg::symlink::Id, H>,
) -> Result<HashSet<tg::directory::Id, H>> {
	let resolved_paths =
		futures::future::try_join_all(unresolved_paths.iter().map(|symlink_id| async {
			let symlink = tg::Symlink::with_id(symlink_id.clone());
			if let Ok(Some(tg::Artifact::Directory(directory))) = symlink.resolve(tg).await {
				let dir_id = directory.id(tg).await?;
				Ok::<_, tangram_error::Error>(Some(dir_id.clone()))
			} else {
				Ok(None)
			}
		}))
		.await?
		.into_iter()
		.flatten()
		.collect::<HashSet<_, H>>();
	Ok(resolved_paths)
}

/// Given a set of directory IDs, update the `library_paths` set to contain a matching set of symlinks with no `path` stored.
async fn store_dirs_as_symlinks<H: BuildHasher + Default>(
	tg: &dyn tg::Handle,
	dirs: HashSet<tg::directory::Id, H>,
) -> Result<HashSet<tg::symlink::Id, H>> {
	let result = try_join_all(dirs.iter().map(|dir_id| async {
		let directory = tg::Directory::with_id(dir_id.clone());
		let symlink = tg::Symlink::new(Some(directory.into()), None);
		let symlink_id = symlink.id(tg).await?;
		Ok::<_, tangram_error::Error>(symlink_id.clone())
	}))
	.await?
	.into_iter()
	.collect::<HashSet<_, H>>();
	Ok(result)
}

#[tracing::instrument(skip(tg, file))]
async fn find_transitive_needed_libraries<H: BuildHasher + Default + Send + Sync>(
	tg: &dyn tg::Handle,
	file: &tg::File,
	library_paths: &HashSet<tg::directory::Id, H>,
	all_needed_libraries: &mut HashMap<String, Option<tg::directory::Id>, H>,
	max_depth: usize,
	depth: usize,
) -> Result<()> {
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

	for dir_id in library_paths {
		let directory = tg::Directory::with_id(dir_id.clone());
		tracing::trace!(?dir_id, "Checking directory for libraries.");
		let copy = all_needed_libraries.keys().cloned().collect_vec();
		for library_name in copy {
			if all_needed_libraries
				.get(&library_name)
				.unwrap_or(&None)
				.is_some()
			{
				continue;
			}
			if let Ok(Some(tg::artifact::Artifact::File(found_library))) = directory
				.try_get(
					tg,
					&tg::Path::from_str(&library_name)
						.map_err(|error| error!(source = error, "could not create path"))?,
				)
				.await
			{
				tracing::trace!(?found_library, ?library_name, "Found library file.");
				*all_needed_libraries
					.entry(library_name.clone())
					.or_insert(None) = Some(dir_id.clone());
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

#[tracing::instrument]
fn found_all_libraries<H: BuildHasher + Default>(
	all_needed_libraries: &HashMap<String, Option<tg::directory::Id>, H>,
) -> bool {
	all_needed_libraries.is_empty() || all_needed_libraries.values().all(Option::is_some)
}

/// Analyze an output file.
async fn analyze_output_file(path: impl AsRef<std::path::Path>) -> Result<AnalyzeOutputFileOutput> {
	let bytes = bytes_from_path(path).await?;
	analyze_executable(&bytes)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum LinuxInterpreterFlavor {
	Default,
	Musl,
}

/// Determine the flavor of the `ld-linux.so` executable at the given path, if it is one.
async fn determine_interpreter_flavor(
	path: impl AsRef<std::path::Path>,
) -> Result<LinuxInterpreterFlavor> {
	let path = path.as_ref();
	let path = std::fs::canonicalize(path).map_err(|error| {
		error!(
			source = error,
			"failed to canonicalize path {}",
			path.display()
		)
	})?;

	let bytes = bytes_from_path(path).await?;

	let object = goblin::Object::parse(&bytes)
		.map_err(|error| error!(source = error, "failed to parse output file as an object"))?;
	if let goblin::Object::Elf(elf) = object {
		let flavor = if elf.soname.is_some() && elf.soname.unwrap().starts_with("ld-linux") {
			LinuxInterpreterFlavor::Default
		} else {
			LinuxInterpreterFlavor::Musl
		};
		Ok(flavor)
	} else {
		Err(error!("unsupported object type, expected elf file"))
	}
}

/// Analyze an executable.
fn analyze_executable(bytes: &[u8]) -> Result<AnalyzeOutputFileOutput> {
	// Parse the object and analyze it.
	let object = goblin::Object::parse(bytes)
		.map_err(|error| error!(source = error, "failed to parse output file as an object"))?;
	let result = match object {
		// Handle an archive file.
		goblin::Object::Archive(_) => AnalyzeOutputFileOutput {
			is_executable: false,
			interpreter: InterpreterRequirement::None,
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
						InterpreterRequirement::Default
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
				needed_libraries,
			}
		},

		// Handle a Mach-O file.
		goblin::Object::Mach(mach) => match mach {
			goblin::mach::Mach::Binary(mach) => {
				let is_executable = mach.header.filetype == goblin::mach::header::MH_EXECUTE;
				let needed_libraries = mach
					.libs
					.iter()
					.map(std::string::ToString::to_string)
					.collect_vec();

				AnalyzeOutputFileOutput {
					is_executable,
					interpreter: InterpreterRequirement::Default,
					needed_libraries,
				}
			},
			goblin::mach::Mach::Fat(mach) => {
				let (is_executable, needed_libraries) = mach
					.into_iter()
					.filter_map(std::result::Result::ok)
					.fold((false, vec![]), |acc, arch| match arch {
						goblin::mach::SingleArch::Archive(_) => (true, acc.1),
						goblin::mach::SingleArch::MachO(mach) => {
							let acc_executable = acc.0;
							let mut libs = acc.1;
							let executable = acc_executable
								|| (mach.header.filetype == goblin::mach::header::MH_EXECUTE);
							libs.extend(mach.libs.iter().map(std::string::ToString::to_string));
							(executable, libs)
						},
					});
				AnalyzeOutputFileOutput {
					is_executable,
					interpreter: InterpreterRequirement::Default,
					needed_libraries,
				}
			},
		},

		_ => panic!("Unsupported object type."),
	};

	Ok(result)
}

async fn bytes_from_path(path: impl AsRef<std::path::Path>) -> Result<Vec<u8>> {
	let mut reader =
		tokio::io::BufReader::new(tokio::fs::File::open(&path).await.map_err(|error| {
			error!(
				source = error,
				r#"failed to open the file at path "{}""#,
				path.as_ref().display()
			)
		})?);

	let mut bytes = Vec::new();
	reader
		.read_to_end(&mut bytes)
		.await
		.map_err(|error| error!(source = error, "failed to read the output file"))?;

	Ok(bytes)
}

async fn file_from_reader(
	tg: &dyn tg::Handle,
	reader: impl AsyncRead + Unpin,
	is_executable: bool,
) -> Result<tg::File> {
	let blob = tg::Blob::with_reader(tg, reader)
		.await
		.map_err(|error| error!(source = error, "could not create blob"))?;
	let file = tg::File::builder(blob).executable(is_executable).build();
	Ok(file)
}

fn setup_tracing(targets: Option<&str>) {
	let targets_layer =
		targets.and_then(|filter| filter.parse::<tracing_subscriber::filter::Targets>().ok());

	// If tracing is enabled, create and initialize the subscriber.
	if let Some(targets_layer) = targets_layer {
		let format_layer = tracing_subscriber::fmt::layer()
			.compact()
			.with_ansi(false)
			.with_span_events(tracing_subscriber::fmt::format::FmtSpan::NEW)
			.with_writer(std::io::stderr);
		let subscriber = tracing_subscriber::registry()
			.with(targets_layer)
			.with(format_layer);
		subscriber.init();
	}
}

async fn template_data_to_symlink_data<F>(template: F) -> Result<tg::symlink::Data>
where
	F: futures::Future<Output = tg::template::Data>,
{
	let components = template.await.components;
	match components.as_slice() {
		[tg::template::component::Data::String(s)] => Ok(tg::symlink::Data {
			artifact: None,
			path: Some(s.to_owned()),
		}),
		[tg::template::component::Data::Artifact(id)]
		| [tg::template::component::Data::String(_), tg::template::component::Data::Artifact(id)] => {
			Ok(tg::symlink::Data {
				artifact: Some(id.clone()),
				path: None,
			})
		},
		[tg::template::component::Data::Artifact(artifact_id), tg::template::component::Data::String(s)]
		| [tg::template::component::Data::String(_), tg::template::component::Data::Artifact(artifact_id), tg::template::component::Data::String(s)] => {
			Ok(tg::symlink::Data {
				artifact: Some(artifact_id.clone()),
				path: Some(s.strip_prefix('/').unwrap().to_owned()),
			})
		},
		_ => Err(error!(
			"expected a template with 1-3 components, got {:?}",
			components
		)),
	}
}

async fn unrender(tg: &dyn tg::Handle, string: &str) -> tg::template::Data {
	tg::Template::unrender(string)
		.expect("Failed to unrender template")
		.data(tg)
		.await
		.expect("Failed to produce template data from template")
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
