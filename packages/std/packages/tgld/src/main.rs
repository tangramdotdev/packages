use {
	itertools::Itertools as _,
	std::{
		collections::{BTreeMap, HashMap, HashSet},
		ffi::OsString,
		hash::BuildHasher,
		path::PathBuf,
	},
	tangram_client::prelude::*,
	tokio::io::AsyncReadExt as _,
};

mod controls;
mod payload;

type Hasher = fnv::FnvBuildHasher;

fn main() {
	if let Err(e) = main_inner() {
		common::error::print_error(e);
		std::process::exit(1);
	}
}

fn main_inner() -> tg::Result<()> {
	// Setup tracing.
	common::tracing::setup("TANGRAM_LINKER_TRACING");

	tg::init()?;
	let runtime = tokio::runtime::Builder::new_current_thread()
		.enable_all()
		.build()
		.unwrap();

	// Read the options from the environment and arguments.
	let options = read_options()?;
	tracing::debug!(
		passthrough = options.passthrough,
		embed = options.embed,
		"parsed the controls"
	);

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
	runtime.block_on(create_wrapper(&options))?;

	Ok(())
}

// The options read from the environment and arguments.
#[derive(Debug)]
struct Options {
	/// Paths which may contain additional dynamic libraries passed on the command line, not via a library path.
	additional_library_candidate_paths: Vec<PathBuf>,

	/// The original arguments to the command.
	command_args: Vec<OsString>,

	/// The path to the command that will be invoked.
	command_path: PathBuf,

	/// If any NEEDED libraries are missing at the end, should we still produce a wrapper?. Will warn if false, error if true. Default: false.
	disallow_missing: bool,

	/// If enabled, the wrapper will be embedded into the binary.
	embed: bool,

	/// The path to the injection library.
	injection_path: Option<String>,

	/// Any additional arguments to pass to the interpreter.
	interpreter_args: Option<String>,

	/// The interpreter used by the output executable.
	interpreter_path: Option<String>,

	/// Library path optimization strategy. Select `none`, `filter`, `resolve`, `isolate`, or `combine`. Defaults to `isolate`.
	library_path_strategy: LibraryPathStrategy,

	/// The library paths.
	library_paths: Vec<String>,

	/// The maximum number of transitive library path searches to perform during optimization. Defaults to 16.
	max_depth: usize,

	/// The output path.
	output_path: PathBuf,

	/// Whether the linker should run in passthrough mode.
	passthrough: bool,

	/// Additional argument values to set in the wrapper.
	wrapper_arg_value: Option<Vec<tg::Template>>,

	/// Additional environment variable values to set in the wrapper.
	wrapper_env_value: Option<tg::Mutation>,
}

// Read the options from the environment and arguments.
fn read_options() -> tg::Result<Options> {
	read_options_with_args(std::env::args_os().skip(1), |name| std::env::var_os(name))
}

#[allow(clippy::too_many_lines)]
fn read_options_with_args(
	mut args: impl Iterator<Item = OsString>,
	mut lookup: impl FnMut(&str) -> Option<OsString>,
) -> tg::Result<Options> {
	let mut command_args = Vec::new();
	let mut output_path: Option<PathBuf> = None;
	let mut library_paths = Vec::new();
	let command_path = lookup("TANGRAM_LINKER_COMMAND_PATH")
		.ok_or_else(|| tg::error!("TANGRAM_LINKER_COMMAND_PATH must be set"))?
		.into();
	let interpreter_path =
		lookup("TANGRAM_LINKER_INTERPRETER_PATH").and_then(|value| value.into_string().ok());
	let interpreter_args =
		lookup("TANGRAM_LINKER_INTERPRETER_ARGS").and_then(|value| value.into_string().ok());
	let injection_path =
		lookup("TANGRAM_LINKER_INJECTION_PATH").and_then(|value| value.into_string().ok());
	let mut session = proxy::options::Session::new(
		"linker",
		controls::DECLARATIONS,
		controls::Settings::default(),
		lookup,
		controls::apply,
	)?;
	let mut additional_library_candidate_paths = Vec::new();

	// Handle the arguments.
	while let Some(arg) = args.next() {
		if session.consume(&arg)? {
			continue;
		}
		command_args.push(arg.clone());
		let Some(arg) = arg.to_str() else {
			continue;
		};
		if session.ended() {
			if is_library_candidate(arg)
				&& let Ok(path) = std::fs::canonicalize(arg)
			{
				additional_library_candidate_paths.push(path);
			}
			continue;
		}

		// Handle the output path argument.
		if arg == "-o" || arg == "--output" {
			if let Some(path) = args.next() {
				command_args.push(path.clone());
				output_path = Some(path.into());
			}
		} else if let Some(output_arg) = arg.strip_prefix("-o") {
			output_path = Some(output_arg.into());
		} else if let Some(output_arg) = arg.strip_prefix("--output=") {
			output_path = Some(output_arg.into());
		}

		// Handle the library path argument.
		if arg == "-L" || arg == "--library-path" {
			if let Some(library_path) = args.next() {
				command_args.push(library_path.clone());
				library_paths.push(
					library_path
						.into_string()
						.map_err(|_| tg::error!("expected a UTF-8 library path"))?,
				);
			}
		} else if let Some(library_arg) = arg.strip_prefix("--library-path=") {
			library_paths.push(library_arg.to_owned());
		} else if let Some(library_path) = arg.strip_prefix("-L") {
			library_paths.push(library_path.to_owned());
		} else if let Some(wl_args) = arg.strip_prefix("-Wl,") {
			// Handle -Wl,-L,/path and -Wl,-rpath-link,/path.
			let parts: Vec<&str> = wl_args.split(',').collect();
			for window in parts.windows(2) {
				if window[0] == "-L" || window[0] == "-rpath-link" {
					library_paths.extend(
						window[1]
							.split(':')
							.filter(|p| !p.is_empty())
							.map(String::from),
					);
				}
			}
			// Handle -Wl,-L=/path and -Wl,-rpath-link=/path forms.
			for part in &parts {
				if let Some(path) = part
					.strip_prefix("-L=")
					.or_else(|| part.strip_prefix("-rpath-link="))
				{
					library_paths
						.extend(path.split(':').filter(|p| !p.is_empty()).map(String::from));
				}
			}
		}

		// Add any dynamic libraries passed directly to the linker.
		if is_library_candidate(arg) {
			// If the path can't be canonicalized, do nothing - it's not a valid library candidate.
			if let Ok(canonical_path) = std::fs::canonicalize(arg) {
				additional_library_candidate_paths.push(canonical_path);
			}
		}
	}

	// If no explicit output path was provided, instead look for `a.out`.
	let output_path = output_path.unwrap_or_else(|| "a.out".into());
	let controls::Settings {
		disallow_missing,
		embed,
		library_path_strategy,
		max_depth,
		passthrough,
		wrapper_arg_value,
		wrapper_env_value,
	} = session.into_settings();

	let options = Options {
		additional_library_candidate_paths,
		command_args,
		command_path,
		disallow_missing,
		embed,
		injection_path,
		interpreter_args,
		interpreter_path,
		library_path_strategy,
		library_paths,
		max_depth,
		output_path,
		passthrough,
		wrapper_arg_value,
		wrapper_env_value,
	};

	Ok(options)
}

#[allow(clippy::too_many_lines)]
async fn create_wrapper(options: &Options) -> tg::Result<()> {
	// Analyze the output file.
	let AnalyzeOutputFileOutput {
		is_executable,
		interpreter,
		name,
		needed_libraries: initial_needed_libraries,
		entrypoint,
	} = analyze_output_file(&options.output_path).await?;
	tracing::debug!(?is_executable, ?interpreter, ?initial_needed_libraries);

	// If the file is executable but does not need an interpreter, it is static or static-PIE linked. Abort here.
	if !options.embed && is_executable && matches!(interpreter, InterpreterRequirement::None) {
		tracing::info!("No interpreter needed for static executable. Exiting without wrapping.");
		return Ok(());
	}

	// Set the initially known needed libraries. This map will track which library path contains each needed library.
	let mut needed_libraries: HashMap<String, Option<DirectoryWithSubpath>, Hasher> =
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
		&options.additional_library_candidate_paths,
		&needed_libraries,
	)
	.await?;

	// Check in each library directory and retain the context returned by the server.
	let mut library_paths = command_line_library_path
		.into_iter()
		.chain(
			futures::future::try_join_all(
				options
					.library_paths
					.iter()
					.unique()
					.map(|path| checkin_library_path(path)),
			)
			.await?
			.into_iter()
			.flatten(),
		)
		.collect_vec();
	deduplicate_library_paths(&mut library_paths);

	tracing::debug!(?library_paths, "Library paths");

	// Obtain the file artifact from the output path.
	let (output_file, original_permissions) = {
		// Store the original file permissions before check in.
		let output_path = std::fs::canonicalize(&options.output_path)
			.map_err(|error| tg::error!(source = error, "cannot canonicalize output path"))?;
		let original_metadata = std::fs::metadata(&output_path)
			.map_err(|error| tg::error!(source = error, "failed to read file metadata"))?;
		let original_permissions = original_metadata.permissions();

		tracing::debug!(?output_path, "about to check in output file");
		let output = tg::checkin(tg::checkin::Arg {
			options: tg::checkin::Options {
				destructive: false,
				deterministic: true,
				ignore: false,
				source_dependencies: true,
				locked: false,
				lock: None,
				root: true,
				..tg::checkin::Options::default()
			},
			path: output_path,
			updates: vec![],
		})
		.await?;
		let output_file = tg::Artifact::with_referent(output.artifact)
			.try_unwrap_file()
			.map_err(|error| tg::error!(source = error, "expected a file"))?;

		(output_file, original_permissions)
	};
	let output_file_id = output_file.id();
	tracing::debug!(?output_file_id, "checked in output file");

	let library_paths = if library_paths.is_empty() {
		None
	} else {
		let strategy = options.library_path_strategy;
		tracing::trace!(
			?library_paths,
			?needed_libraries,
			?strategy,
			"pre-optimize library paths"
		);

		let library_paths = optimize_library_paths(
			&output_file,
			library_paths,
			&mut needed_libraries,
			options.library_path_strategy,
			options.max_depth,
			options.disallow_missing,
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
		// Keep the authorized output artifact.
		let output_artifact = output_file.clone().into();

		// Create the manifest.
		let mut manifest =
			create_manifest(output_artifact, options, interpreter, library_paths).await?;
		tracing::trace!(?manifest);

		// If requested, embed the wrapper.
		let new_wrapper = if options.embed {
			if let Some(entrypoint) = entrypoint {
				manifest.executable = common::manifest::Executable::Address(entrypoint);
			}
			manifest.embed(&output_file).await?
		} else {
			manifest.write().await?
		};

		// Write the manifest to a wrapper.
		let new_wrapper_id = new_wrapper.id();
		tracing::trace!(?new_wrapper_id);

		// Create a file with the new blob and references.
		Some(new_wrapper)
	} else if let Some(library_paths) = library_paths {
		// If the linker generated a library, then add the library paths to its references.
		let mut dependencies = output_file.dependencies().await?;
		for path in library_paths {
			let reference = tg::Reference::with_object(path.directory.id().into());
			let object = path.directory.into();
			dependencies.entry(reference).or_insert_with(|| {
				Some(tg::file::Dependency(tg::Referent::with_node(Some(object))))
			});
		}
		let output_file_contents = output_file.contents().await?;
		// NOTE - in practice, `output_file_executable` will virtually always be false in this branch, but we don't want to lose the information if the caller is doing something fancy.
		let output_file_executable = output_file.executable().await?;
		Some(
			tg::File::builder()
				.contents(output_file_contents)
				.executable(output_file_executable)
				.dependencies(dependencies)
				.build()
				.map_err(|error| tg::error!(!error, "failed to build output file"))?,
		)
	} else {
		None
	};

	if let Some(output_file) = output_file {
		tracing::trace!(output_file = ?output_file.id(), "storing...");
		output_file.store().await?;
		tracing::trace!(output_file = ?output_file.id(), "stored");
		tokio::fs::remove_file(&options.output_path)
			.await
			.map_err(|error| tg::error!(!error, path = %&options.output_path.display(), "failed to remove the output file"))?;
		let cwd = std::env::current_dir()
			.map_err(|error| tg::error!(!error, "failed to get the current directory"))?;
		let output_path = cwd.join(&options.output_path);
		let output_file_id = output_file.id();
		tracing::debug!(?output_file_id, ?output_path, "checking out output file");
		let artifact = tg::Artifact::from(output_file);
		common::checkout_artifact_to_path(artifact, output_path.clone()).await?;

		// Restore the original file permissions after checkout.
		std::fs::set_permissions(&output_path, original_permissions).map_err(
			|error| tg::error!(!error, path = %output_path.display(), "failed to restore file permissions"),
		)?;
		tracing::debug!(?output_path, "restored original file permissions");
	}

	Ok(())
}

fn deduplicate_library_paths(library_paths: &mut Vec<DirectoryWithSubpath>) {
	let mut seen = HashSet::<_, Hasher>::default();
	library_paths.retain(|path| seen.insert((path.directory.id(), path.subpath.clone())));
}

// Keep the server's containing root, adding aliases for local libraries whose SONAME or install name differs from their filename.
async fn checkin_library_path(path: &str) -> tg::Result<Option<DirectoryWithSubpath>> {
	if !std::path::Path::new(path).is_dir() {
		return Ok(None);
	}
	let mut entries = tokio::fs::read_dir(path)
		.await
		.map_err(|error| tg::error!(!error, "failed to read library directory"))?;
	if entries
		.next_entry()
		.await
		.map_err(|error| tg::error!(!error, "failed to read library directory entry"))?
		.is_none()
	{
		return Ok(None);
	}
	let mut output = common::checkin_path(path).await?;
	if matches!(output.artifact.node, tg::artifact::Id::Symlink(_)) {
		let target = std::fs::canonicalize(path)
			.map_err(|error| tg::error!(!error, "failed to resolve library directory symlink"))?;
		output = common::checkin_path(target).await?;
	}
	let artifact = tg::Artifact::with_referent(output.artifact.clone());
	let directory = artifact
		.try_unwrap_directory()
		.map_err(|_| tg::error!("expected a library directory"))?;
	let (root, subpath) = common::artifact_path(&output.artifact)?;
	let root = root
		.try_unwrap_directory()
		.map_err(|_| tg::error!("expected a containing directory"))?;
	if !library_path_needs_aliases(&output.artifact) {
		return Ok(Some(DirectoryWithSubpath {
			directory: root,
			subpath,
		}));
	}
	// Start a fresh scan so the emptiness check does not consume the first entry.
	let mut entries = tokio::fs::read_dir(path)
		.await
		.map_err(|error| tg::error!(!error, "failed to read library directory"))?;
	let prefix = subpath.clone().unwrap_or_default();
	let mut builder: Option<tg::directory::Builder> = None;
	while let Some(entry) = entries
		.next_entry()
		.await
		.map_err(|error| tg::error!(!error, "failed to read library directory entry"))?
	{
		if !entry
			.file_type()
			.await
			.map_err(|error| tg::error!(!error, "failed to read file type"))?
			.is_file()
		{
			continue;
		}
		let Ok(AnalyzeOutputFileOutput {
			name: Some(name), ..
		}) = analyze_output_file(entry.path()).await
		else {
			continue;
		};
		if entry.file_name() == name.as_str() || directory.try_get(&name).await?.is_some() {
			continue;
		}
		let alias = tg::Symlink::with_artifact_and_path(
			root.clone().into(),
			prefix.join(entry.file_name()),
		);
		let current = match builder.take() {
			Some(builder) => builder,
			None => root.to_builder().await?,
		};
		builder = Some(current.add(&prefix.join(name), alias.into()).await?);
	}
	let root = builder.map_or(root, tg::directory::Builder::build);
	Ok(Some(DirectoryWithSubpath {
		directory: root,
		subpath,
	}))
}

fn library_path_needs_aliases(referent: &tg::Referent<tg::artifact::Id>) -> bool {
	// Checkin returns an absolute source path for local directories and a relative subpath or no path for store artifacts.
	referent.options.id.is_none()
		&& referent
			.options
			.path
			.as_ref()
			.is_some_and(|path| path.is_absolute())
}

fn extract_filename(path: &(impl AsRef<str> + ToString + ?Sized)) -> String {
	std::path::Path::new(path.as_ref()).file_name().map_or_else(
		|| path.to_string(),
		|name| name.to_string_lossy().to_string(),
	)
}

/// Create a manifest.
#[allow(clippy::too_many_lines)]
async fn create_manifest(
	ld_output: tg::Artifact,
	options: &Options,
	interpreter: InterpreterRequirement,
	library_paths: Option<Vec<DirectoryWithSubpath>>,
) -> tg::Result<common::Manifest> {
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

		// Keep the library directory handles and their subpaths.
		let library_paths = library_paths.map(|paths| {
			paths
				.into_iter()
				.map(|path| {
					if let Some(subpath) = path.subpath {
						common::template_from_artifact_and_subpath(path.directory.into(), subpath)
					} else {
						common::template_from_artifact(path.directory.into())
					}
				})
				.collect()
		});
		tracing::trace!(?library_paths, "Library paths");

		if let Some((path, interpreter_flavor)) = config {
			let preloads = if let Some(path) = &options.injection_path {
				Some(vec![common::template_from_path(path).await?])
			} else {
				None
			};
			let args = if let Some(value) = &options.interpreter_args {
				Some(
					common::interpreter_args(value, async |path| {
						common::template_from_path(path).await
					})
					.await?,
				)
			} else {
				None
			};

			match interpreter_flavor {
				InterpreterFlavor::Dyld => Some(common::manifest::Interpreter::DyLd(
					common::manifest::DyLdInterpreter {
						library_paths,
						preloads,
					},
				)),
				InterpreterFlavor::Gnu => {
					let path = common::template_from_path(&path).await?;
					Some(common::manifest::Interpreter::LdLinux(
						common::manifest::LdLinuxInterpreter {
							args,
							library_paths,
							path,
							preloads,
						},
					))
				},
				InterpreterFlavor::Musl => {
					let path = common::template_from_path(&path).await?;
					Some(common::manifest::Interpreter::LdMusl(
						common::manifest::LdMuslInterpreter {
							args,
							library_paths,
							path,
							preloads,
						},
					))
				},
			}
		} else {
			// There was no interpreter specified. We are likely a statically linked executable.
			None
		}
	};

	// Create the executable.
	let executable = common::manifest::Executable::Path(common::template_from_artifact(ld_output));

	// Create empty values for env and args.
	let env = options.wrapper_env_value.clone();
	let args = options.wrapper_arg_value.clone();

	// Create the manifest.
	let manifest = common::Manifest {
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
	/// The entrypoint of the executable.
	entrypoint: Option<u64>,
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
enum LibraryPathStrategy {
	/// Do not manipulate library paths.
	None,
	/// Only retain paths containing needed libraries.
	Filter,
	/// Resolve any artifacts with subpaths to their innermost directory.
	Resolve,
	/// Create individual library paths for each library.
	#[default]
	Isolate,
	/// Combine library paths into a single directory.
	Combine,
}

impl std::str::FromStr for LibraryPathStrategy {
	type Err = tg::Error;

	fn from_str(s: &str) -> Result<Self, Self::Err> {
		match s.to_ascii_lowercase().as_str() {
			"none" => Ok(Self::None),
			"filter" => Ok(Self::Filter),
			"resolve" => Ok(Self::Resolve),
			"isolate" => Ok(Self::Isolate),
			"combine" => Ok(Self::Combine),
			_ => Err(tg::error!("invalid library path optimization strategy {s}")),
		}
	}
}

/// Check in any files needed libraries and produce a directory with correct names, returning a [`DirectoryWithSubpath`].
async fn create_library_directory_for_command_line_libraries<H: BuildHasher>(
	library_candidate_paths: &[PathBuf],
	all_needed_libraries: &HashMap<String, Option<DirectoryWithSubpath>, H>,
) -> tg::Result<Option<DirectoryWithSubpath>> {
	let mut entries = BTreeMap::new();
	for library_candidate_path in library_candidate_paths {
		if let Ok(AnalyzeOutputFileOutput {
			name: Some(name), ..
		}) = analyze_output_file(library_candidate_path).await
		{
			// Ensure the file is actually an object. If not, skip it.
			if all_needed_libraries.contains_key(&name) {
				tracing::debug!(
					?library_candidate_path,
					"verifying command line library candidate"
				);

				let output = common::checkin_path(library_candidate_path).await?;
				let library_candidate_file = tg::Artifact::with_referent(output.artifact)
					.try_unwrap_file()
					.map_err(|_| tg::error!("expected a library file"))?;

				// Add an entry to the directory.
				entries.insert(name, tg::Artifact::File(library_candidate_file));
			}
		}
	}

	let result = if entries.is_empty() {
		None
	} else {
		let directory = tg::Directory::with_entries(entries);
		Some(DirectoryWithSubpath {
			directory,
			subpath: None,
		})
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
	file: &tg::File,
	library_paths: Vec<DirectoryWithSubpath>,
	needed_libraries: &mut HashMap<String, Option<DirectoryWithSubpath>, H>,
	strategy: LibraryPathStrategy,
	max_depth: usize,
	disallow_missing: bool,
) -> tg::Result<Vec<DirectoryWithSubpath>> {
	if matches!(strategy, LibraryPathStrategy::None) || library_paths.is_empty() {
		return Ok(library_paths);
	}

	// Find all the transitive needed libraries of the output file we can locate in the library path.
	find_transitive_needed_libraries(file, &library_paths, needed_libraries, max_depth, 0).await?;
	tracing::debug!(?needed_libraries, "post-find");

	let filtered_library_paths = library_paths
		.into_iter()
		.filter(|path| {
			needed_libraries.values().flatten().any(|found| {
				path.directory.id() == found.directory.id() && path.subpath == found.subpath
			})
		})
		.collect();
	tracing::debug!(?filtered_library_paths, "post-filter");

	if matches!(strategy, LibraryPathStrategy::Filter) {
		return finalize_library_paths(disallow_missing, filtered_library_paths, needed_libraries)
			.await;
	}

	match strategy {
		LibraryPathStrategy::Resolve => {
			let resolved_library_paths = resolve_directories(&filtered_library_paths).await?;
			tracing::trace!(?resolved_library_paths, "post-resolve");
			return finalize_library_paths(
				disallow_missing,
				resolved_library_paths,
				needed_libraries,
			)
			.await;
		},
		LibraryPathStrategy::Isolate => {
			let isolated_library_paths = isolate_library_paths(needed_libraries).await?;
			tracing::trace!(?isolated_library_paths, "post-isolate");

			return finalize_library_paths(
				disallow_missing,
				isolated_library_paths,
				needed_libraries,
			)
			.await;
		},
		LibraryPathStrategy::Combine => {
			let combined_library_path = combine_library_paths(needed_libraries).await?;
			tracing::trace!(?combined_library_path, "post-combine");

			return finalize_library_paths(
				disallow_missing,
				combined_library_path,
				needed_libraries,
			)
			.await;
		},
		_ => {
			unreachable!("the none and filter cases have already been handled")
		},
	}
}

async fn isolate_library_paths<H: BuildHasher + Default>(
	needed_libraries: &HashMap<String, Option<DirectoryWithSubpath>, H>,
) -> tg::Result<Vec<DirectoryWithSubpath>> {
	let mut isolated_library_paths = Vec::new();
	for (name, dir_with_subpath) in located_libraries(needed_libraries) {
		let directory = dir_with_subpath.resolve().await?;
		let Ok(Some(artifact)) = directory.try_get(name).await else {
			continue;
		};
		let mut entries = BTreeMap::new();
		entries.insert(name.clone(), artifact);
		let directory = tg::Directory::with_entries(entries);
		isolated_library_paths.push(DirectoryWithSubpath {
			directory,
			subpath: None,
		});
	}

	Ok(isolated_library_paths)
}

async fn combine_library_paths<H: BuildHasher + Default>(
	needed_libraries: &HashMap<String, Option<DirectoryWithSubpath>, H>,
) -> tg::Result<Vec<DirectoryWithSubpath>> {
	let mut entries = BTreeMap::new();
	for (name, dir_with_subpath) in located_libraries(needed_libraries) {
		let directory = dir_with_subpath.resolve().await?;
		if let Ok(Some(artifact)) = directory.try_get(name).await {
			entries.insert(name.clone(), artifact);
		}
	}
	if entries.is_empty() {
		return Ok(Vec::new());
	}
	let directory = tg::Directory::with_entries(entries);
	Ok(vec![DirectoryWithSubpath {
		directory,
		subpath: None,
	}])
}

/// Produce the set of library paths to be written to the wrapper post-optimization.
async fn finalize_library_paths<H: BuildHasher + Default>(
	disallow_missing: bool,
	library_paths: Vec<DirectoryWithSubpath>,
	needed_libraries: &HashMap<String, Option<DirectoryWithSubpath>, H>,
) -> tg::Result<Vec<DirectoryWithSubpath>> {
	// Warn or error if any required libraries are not included in the set.
	verify_missing_libraries(disallow_missing, needed_libraries, &library_paths).await?;
	Ok(library_paths)
}

/// Given a list of needed library names and a set of selected paths, report which libraries are not accounted for.
async fn verify_missing_libraries<H: BuildHasher + Default>(
	disallow_missing: bool,
	needed_libraries: &HashMap<String, Option<DirectoryWithSubpath>, H>,
	library_paths: &[DirectoryWithSubpath],
) -> tg::Result<()> {
	let basename = |library_name: &str| -> tg::Result<String> {
		let res = std::path::Path::new(&library_name)
			.file_stem()
			.and_then(|s| s.to_str())
			.ok_or_else(|| tg::error!("could not determine basename for library {library_name}"))?;
		Ok(res.to_owned())
	};

	let futures = library_paths.iter().map(|library_path| async move {
		let directory = library_path.resolve().await?;
		Ok::<_, tg::Error>(directory.entries().await?.into_keys().collect_vec())
	});
	let entries = futures::future::try_join_all(futures).await?;

	let found_libraries: HashSet<String, H> = entries
		.iter()
		.flatten()
		.map(|name| basename(name))
		.collect::<tg::Result<_>>()?;
	let needed_library_names: HashSet<String, H> = needed_libraries
		.keys()
		.map(|lib| basename(lib))
		.collect::<tg::Result<_>>()?;
	tracing::debug!(
		?found_libraries,
		?needed_library_names,
		"comparing found libraries to needed libraries"
	);

	let missing_libs = needed_library_names
		.difference(&found_libraries)
		.collect_vec();
	if !missing_libs.is_empty() {
		if disallow_missing {
			return Err(tg::error!(
				?library_paths,
				?missing_libs,
				"could not find required libraries"
			));
		}
		tracing::warn!(
			?library_paths,
			"Could not find the following required libraries: {missing_libs:?}"
		);
	}
	Ok(())
}

/// Given a set of directories which may contain subpaths, return structs with the item resolved to the inner directory.
async fn resolve_directories(
	unresolved_paths: &[DirectoryWithSubpath],
) -> tg::Result<Vec<DirectoryWithSubpath>> {
	futures::future::try_join_all(unresolved_paths.iter().map(|dir_with_subpath| async {
		if dir_with_subpath.subpath.is_some() {
			let directory = dir_with_subpath.resolve().await?;
			Ok(DirectoryWithSubpath {
				directory,
				subpath: None,
			})
		} else {
			Ok(dir_with_subpath.clone())
		}
	}))
	.await
}

/// Recursively find all needed libraries for an executable.
async fn find_transitive_needed_libraries<H: BuildHasher + Default + Send + Sync>(
	file: &tg::File,
	library_paths: &[DirectoryWithSubpath],
	all_needed_libraries: &mut HashMap<String, Option<DirectoryWithSubpath>, H>,
	max_depth: usize,
	depth: usize,
) -> tg::Result<()> {
	// Check for transitive dependencies if we've recurred beyond the initial file.
	if depth > 0 {
		let id = file.id();
		tracing::debug!(?id, "analyzing transitive dependency");
		match analyze_executable(&file.bytes().await?) {
			Ok(AnalyzeOutputFileOutput {
				needed_libraries, ..
			}) => {
				tracing::debug!(?id, ?needed_libraries, "found additional needed libraries");
				for library in &needed_libraries {
					if cfg!(target_os = "macos") && library == "libSystem.B.dylib" {
						continue;
					}
					all_needed_libraries.entry(library.clone()).or_insert(None);
				}
			},
			Err(e) => {
				tracing::debug!(?e, ?id, "failed to analyze file as an object!");
			},
		}
	}

	// Check if we're done after analyzing the current file.
	if found_all_libraries(all_needed_libraries) || depth == max_depth {
		return Ok(());
	}

	for dir_with_subpath in library_paths {
		tracing::trace!(?dir_with_subpath, "Checking directory for libraries.");

		let names = all_needed_libraries
			.iter()
			.filter(|(_, located)| located.is_none())
			.map(|(name, _)| name.clone())
			.collect_vec();
		tracing::debug!(?names, "checking for libraries");
		for library_name in names {
			// A recursion earlier in this pass may already have located the library.
			if all_needed_libraries
				.get(&library_name)
				.unwrap_or(&None)
				.is_some()
			{
				continue;
			}
			let path = dir_with_subpath
				.subpath
				.as_deref()
				.unwrap_or(std::path::Path::new(""))
				.join(&library_name);
			// Discovery is best-effort; final verification applies disallow_missing.
			let Ok(Some(tg::Artifact::File(found_library))) =
				dir_with_subpath.directory.try_get(path).await
			else {
				continue;
			};
			let found_library_id = found_library.id();
			tracing::trace!(?found_library_id, ?library_name, "Found library file.");
			*all_needed_libraries
				.entry(library_name.clone())
				.or_insert(None) = Some(dir_with_subpath.clone());
			Box::pin(find_transitive_needed_libraries(
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
		}
	}

	Ok(())
}

fn located_libraries<H: BuildHasher>(
	needed_libraries: &HashMap<String, Option<DirectoryWithSubpath>, H>,
) -> impl Iterator<Item = (&String, &DirectoryWithSubpath)> {
	needed_libraries
		.iter()
		.filter_map(|(name, dir_with_subpath)| {
			dir_with_subpath
				.as_ref()
				.map(|dir_with_subpath| (name, dir_with_subpath))
		})
}

/// Determine if all needed libraries have been found.
#[tracing::instrument]
fn found_all_libraries<H: BuildHasher + Default>(
	all_needed_libraries: &HashMap<String, Option<DirectoryWithSubpath>, H>,
) -> bool {
	all_needed_libraries.is_empty() || all_needed_libraries.values().all(Option::is_some)
}

/// Analyze an output file.
async fn analyze_output_file(
	path: impl AsRef<std::path::Path>,
) -> tg::Result<AnalyzeOutputFileOutput> {
	let bytes = bytes_from_path(&path).await?;
	analyze_executable(&bytes).map_err(
		|error| tg::error!(!error, path = %path.as_ref().display(), "failed to analyze output file"),
	)
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
			entrypoint: None,
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

			let entrypoint = (elf.entry != 0).then_some(elf.entry);

			// Check whether or not the object requires an interpreter:
			// - If the object has an interpreter field.
			// - If the object is a PIE and has 1 or more NEEDS.
			let interpreter =
				if elf.interpreter.is_some() || (is_pie && !needed_libraries.is_empty()) {
					let interpreter = elf
						.interpreter
						.ok_or_else(|| tg::error!("missing interpreter in ELF"))?;
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
				entrypoint,
			}
		},

		// Handle a Mach-O file.
		goblin::Object::Mach(mach) => match mach {
			goblin::mach::Mach::Binary(mach) => {
				let is_executable = mach.header.filetype == goblin::mach::header::MH_EXECUTE;
				let name = mach.name.map(extract_filename);
				let needed_libraries = mach
					.libs
					.iter()
					.map(extract_filename)
					.filter(|file_name| name.as_ref().is_none_or(|n| n != file_name))
					.collect_vec();
				let entrypoint = mach.entry;
				AnalyzeOutputFileOutput {
					is_executable,
					interpreter: InterpreterRequirement::Default(InterpreterFlavor::Dyld),
					name,
					needed_libraries,
					entrypoint: Some(entrypoint),
				}
			},
			goblin::mach::Mach::Fat(mach) => {
				let (is_executable, name, needed_libraries) =
					mach.into_iter().filter_map(std::result::Result::ok).fold(
						(false, None, vec![]),
						|acc, arch| match arch {
							goblin::mach::SingleArch::Archive(_) => (true, None, acc.2),
							goblin::mach::SingleArch::MachO(mach) => {
								let acc_executable = acc.0;
								let mut libs = acc.2;
								let executable = acc_executable
									|| (mach.header.filetype == goblin::mach::header::MH_EXECUTE);
								let name = mach.name.map(extract_filename);
								libs.extend(mach.libs.iter().map(extract_filename).filter(
									|file_name| name.as_ref().is_none_or(|n| n != file_name),
								));
								(executable, name, libs)
							},
						},
					);
				AnalyzeOutputFileOutput {
					is_executable,
					interpreter: InterpreterRequirement::Default(InterpreterFlavor::Dyld),
					name,
					needed_libraries,
					entrypoint: None,
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

#[derive(Clone, Debug)]
pub struct DirectoryWithSubpath {
	directory: tg::Directory,
	subpath: Option<PathBuf>,
}

impl DirectoryWithSubpath {
	async fn resolve(&self) -> tg::Result<tg::Directory> {
		match &self.subpath {
			Some(subpath) => self
				.directory
				.get(subpath)
				.await?
				.try_unwrap_directory()
				.map_err(|_| tg::error!("expected a library directory")),
			None => Ok(self.directory.clone()),
		}
	}
}

#[cfg(test)]
mod tests {
	use {
		super::{
			AnalyzeOutputFileOutput, DirectoryWithSubpath, InterpreterRequirement,
			LibraryPathStrategy, analyze_output_file, deduplicate_library_paths,
			library_path_needs_aliases, optimize_library_paths, verify_missing_libraries,
		},
		tangram_client::prelude::*,
	};

	#[tokio::test]
	async fn absolute_library_dependencies_remain_unresolved() {
		tg::init().unwrap();
		let file = tg::File::with_contents("library");
		let directory =
			tg::Directory::with_entries([("libexample.so".to_owned(), file.clone().into())].into());
		for strategy in [
			LibraryPathStrategy::Filter,
			LibraryPathStrategy::Resolve,
			LibraryPathStrategy::Isolate,
			LibraryPathStrategy::Combine,
		] {
			for disallow_missing in [false, true] {
				let mut needed =
					std::collections::HashMap::from([("/external/libexample.so".to_owned(), None)]);
				let result = optimize_library_paths(
					&file,
					vec![DirectoryWithSubpath {
						directory: directory.clone(),
						subpath: None,
					}],
					&mut needed,
					strategy,
					16,
					disallow_missing,
				)
				.await;
				if disallow_missing {
					assert!(
						result
							.unwrap_err()
							.to_string()
							.contains("could not find required libraries")
					);
				} else {
					assert!(result.unwrap().is_empty());
				}
				assert!(needed["/external/libexample.so"].is_none());
			}
		}
	}

	#[tokio::test]
	async fn library_verification_checks_all_matching_names() {
		tg::init().unwrap();
		let file = tg::File::with_contents("library");
		let libraries = tg::Directory::with_entries(
			[
				("libleaf-real.so".to_owned(), file.into()),
				(
					"libleaf.so".to_owned(),
					tg::Symlink::with_path("libleaf-real.so".into()).into(),
				),
			]
			.into(),
		);
		let root = tg::Directory::with_entries([("lib".to_owned(), libraries.into())].into());
		let paths = [DirectoryWithSubpath {
			directory: root,
			subpath: Some("lib".into()),
		}];
		let mut needed = std::collections::HashMap::from([("libleaf.so".to_owned(), None)]);
		verify_missing_libraries(true, &needed, &paths)
			.await
			.unwrap();
		needed.insert("libmissing.so".to_owned(), None);
		assert!(
			verify_missing_libraries(true, &needed, &paths)
				.await
				.is_err()
		);
	}

	#[test]
	fn alias_scans_are_limited_to_local_checkins() {
		let id = tg::directory::Id::new(b"library directory");
		let root = tg::directory::Id::new(b"containing directory");
		let mut referent = tg::Referent::with_node(id.into());
		assert!(!library_path_needs_aliases(&referent));
		referent.options.id = Some(root.into());
		referent.options.path = Some("lib".into());
		assert!(!library_path_needs_aliases(&referent));
		referent.options.id = None;
		referent.options.path = Some("/work/libraries".into());
		assert!(library_path_needs_aliases(&referent));
	}

	#[test]
	fn library_paths_keep_the_first_handle_and_search_order() {
		let first = tg::Directory::with_entries(std::collections::BTreeMap::new());
		let duplicate = tg::Directory::with_id(first.id());
		let second = tg::Directory::with_id(tg::directory::Id::new(b"second"));

		let mut paths = vec![
			DirectoryWithSubpath {
				directory: first.clone(),
				subpath: Some("lib".into()),
			},
			DirectoryWithSubpath {
				directory: second.clone(),
				subpath: Some("lib".into()),
			},
			DirectoryWithSubpath {
				directory: duplicate,
				subpath: Some("lib".into()),
			},
			DirectoryWithSubpath {
				directory: first.clone(),
				subpath: Some("lib64".into()),
			},
			DirectoryWithSubpath {
				directory: first.clone(),
				subpath: None,
			},
			DirectoryWithSubpath {
				directory: first.clone(),
				subpath: None,
			},
		];
		deduplicate_library_paths(&mut paths);
		assert_eq!(
			paths
				.iter()
				.map(|path| (path.directory.id(), path.subpath.clone()))
				.collect::<Vec<_>>(),
			vec![
				(first.id(), Some("lib".into())),
				(second.id(), Some("lib".into())),
				(first.id(), Some("lib64".into())),
				(first.id(), None),
			],
		);
		assert!(paths[0].directory.state().object().is_some());
	}

	#[test]
	fn native_operands_and_delimiters() {
		use std::{ffi::OsString, os::unix::ffi::OsStringExt as _};
		for option in ["-o", "--output", "-L", "--library-path"] {
			for operand in [
				"--",
				"--tg-linker-passthrough=false",
				"--tg-linker-wrapper-args",
			] {
				let input = vec![
					OsString::from(option),
					operand.into(),
					"--tg-linker-passthrough".into(),
					"--".into(),
					"--tg-linker-passthrough=false".into(),
					OsString::from_vec(b"\xff".to_vec()),
				];
				let options = super::read_options_with_args(input.clone().into_iter(), |key| {
					(key == "TANGRAM_LINKER_COMMAND_PATH").then(|| "ld".into())
				})
				.unwrap();
				assert!(options.passthrough);
				assert_eq!(options.command_args, [&input[..2], &input[3..]].concat());
			}
		}
	}

	#[tokio::test]
	async fn verification_bypasses_need_no_server() {
		use {std::collections::HashMap, tangram_client::prelude::*};
		let file = tg::File::with_contents("unused");
		let mut needed = HashMap::<_, _, super::Hasher>::default();
		needed.insert("missing".to_owned(), None);
		for strategy in [
			super::LibraryPathStrategy::Combine,
			super::LibraryPathStrategy::Filter,
			super::LibraryPathStrategy::Isolate,
			super::LibraryPathStrategy::None,
			super::LibraryPathStrategy::Resolve,
		] {
			assert!(
				super::optimize_library_paths(&file, vec![], &mut needed, strategy, 0, true)
					.await
					.unwrap()
					.is_empty()
			);
		}
		let path = super::DirectoryWithSubpath {
			directory: tg::Directory::with_entries(std::collections::BTreeMap::new()),
			subpath: None,
		};
		assert_eq!(
			super::optimize_library_paths(
				&file,
				vec![path],
				&mut needed,
				super::LibraryPathStrategy::None,
				0,
				true
			)
			.await
			.unwrap()
			.len(),
			1
		);
	}

	#[tokio::test]
	async fn read_output_files() {
		let temp = tempfile::tempdir().unwrap();
		let source = temp.path().join("main.c");
		let executable = temp.path().join("a.out");
		std::fs::write(&source, "int main() { return 0; }").unwrap();
		let compile = |flags: &[&str]| {
			let output = std::process::Command::new("cc")
				.arg(&source)
				.args(flags)
				.arg("-o")
				.arg(&executable)
				.output()
				.expect("failed to run cc");
			assert!(
				output.status.success(),
				"cc {flags:?} failed ({}):\n{}",
				output.status,
				String::from_utf8_lossy(&output.stderr)
			);
		};

		// Test analyzing a shared library.
		compile(&["-shared"]);
		let AnalyzeOutputFileOutput { is_executable, .. } =
			analyze_output_file(&executable).await.unwrap();
		assert!(
			!is_executable,
			"Dynamically linked library was detected as an executable."
		);

		// Test analyzing a dynamic executable with an interpreter.
		compile(&[]);
		let AnalyzeOutputFileOutput {
			is_executable,
			interpreter,
			..
		} = analyze_output_file(&executable).await.unwrap();
		assert!(
			is_executable,
			"Dynamically linked executable was detected as a library."
		);
		assert!(
			!matches!(interpreter, InterpreterRequirement::None),
			"Dynamically linked executables need an interpreter."
		);

		// Test analyzing a statically linked executable.
		#[cfg(target_os = "linux")]
		{
			compile(&["-static", "-static-libgcc"]);
			let AnalyzeOutputFileOutput {
				is_executable,
				interpreter,
				..
			} = analyze_output_file(&executable).await.unwrap();
			assert!(
				is_executable,
				"Statically linked executable was detected as a library."
			);
			assert!(
				matches!(interpreter, InterpreterRequirement::None),
				"Statically linked executables do not need an interpreter."
			);
		}

		// Test analyzing a dynamically linked PIE executable.
		compile(&["-pie"]);
		let AnalyzeOutputFileOutput {
			is_executable,
			interpreter,
			..
		} = analyze_output_file(&executable).await.unwrap();
		assert!(is_executable, "PIE was detected as a library.");
		assert!(
			!matches!(interpreter, InterpreterRequirement::None),
			"PIEs need an interpreter."
		);

		// Test analyzing a static-pie linked executable.
		#[cfg(target_os = "linux")]
		{
			compile(&["-static-pie", "-static-libgcc"]);
			let AnalyzeOutputFileOutput {
				is_executable,
				interpreter,
				..
			} = analyze_output_file(&executable).await.unwrap();
			assert!(
				is_executable,
				"Static-pie linked executable was detected as a library."
			);
			assert!(
				matches!(interpreter, InterpreterRequirement::None),
				"Static-PIE linked executables do not need an interpreter."
			);
		}
	}
}
