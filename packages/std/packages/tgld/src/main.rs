use itertools::Itertools;
use std::{
	collections::{BTreeMap, HashMap, HashSet},
	hash::BuildHasher,
	path::PathBuf,
	str::FromStr,
};
use tangram_client::prelude::*;
use tokio::io::AsyncReadExt as _;

type Hasher = fnv::FnvBuildHasher;

const MAX_DEPTH: usize = 16;

fn main() {
	if let Err(e) = main_inner() {
		common::error::print_error(e);
		std::process::exit(1);
	}
}

fn main_inner() -> tg::Result<()> {
	// Setup tracing.
	common::tracing::setup("TGLD_TRACING");

	tg::init()?;
	let runtime = tokio::runtime::Builder::new_current_thread()
		.enable_all()
		.build()
		.unwrap();

	// Read the options from the environment and arguments.
	let options = read_options()?;
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
	runtime.block_on(create_wrapper(&options))?;

	Ok(())
}

// The options read from the environment and arguments.
#[derive(Debug)]
struct Options {
	/// Paths which may contain additional dynamic libraries passed on the command line, not via a library path.
	additional_library_candidate_paths: Vec<PathBuf>,

	/// The path to the command that will be invoked.
	command_path: PathBuf,

	/// The original arguments to the command.
	command_args: Vec<String>,

	/// If any NEEDED libraries are missing at the end, should we still produce a wrapper?. Will warn if false, error if true. Default: false.
	disallow_missing: bool,

	/// If enabled, the wrapper will be embedded into the binary.
	embed: bool,

	/// The interpreter used by the output executable.
	interpreter_path: Option<String>,

	/// Any additional arguments to pass to the interpreter.
	interpreter_args: Option<String>,

	/// The path to the injection library.
	injection_path: Option<String>,

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
	wrapper_arg_value: Option<Vec<tg::template::Data>>,

	/// Additional environment variable values to set in the wrapper.
	wrapper_env_value: Option<tg::mutation::Data>,
}

// Read the options from the environment and arguments.
#[allow(clippy::too_many_lines)]
fn read_options() -> tg::Result<Options> {
	// Create the output.
	let mut command_args = Vec::new();
	let mut output_path = None;
	let mut library_paths = Vec::new();

	// Get the command.
	let command_path = std::env::var("TGLD_COMMAND_PATH")
		.map_err(|error| tg::error!(source = error, "TGLD_COMMAND_PATH must be set."))?
		.into();

	// Get the passthrough flag.
	let mut passthrough = std::env::var("TGLD_PASSTHROUGH").is_ok();

	// Get the allow_missing flag.
	let mut disallow_missing = std::env::var("TGLD_DISALLOW_MISSING").is_ok();

	// Get the interpreter path.
	let interpreter_path = std::env::var("TGLD_INTERPRETER_PATH").ok();

	// Get the wrap binary.
	let mut embed = std::env::var("TGLD_EMBED_WRAPPER").is_ok();

	// Get additional interpreter arguments, if any.
	let interpreter_args = std::env::var("TGLD_INTERPRETER_ARGS").ok();

	// Get the max depth.
	let mut max_depth = std::env::var("TGLD_MAX_DEPTH")
		.ok()
		.map_or(MAX_DEPTH, |s| s.parse().unwrap_or(MAX_DEPTH));

	// Get the injection path.
	let injection_path = std::env::var("TGLD_INJECTION_PATH").ok();

	// Get the option to disable combining library paths. Enabled by default.
	let mut library_path_optimization = std::env::var("TGLD_LIBRARY_PATH_OPT_LEVEL")
		.ok()
		.map_or(LibraryPathStrategy::default(), |s| {
			s.parse().unwrap_or_default()
		});

	// Get an iterator over the arguments.
	let mut args = std::env::args();

	// Skip arg0.
	args.next();

	// Prepare to store dynamic libraries passed directly to the linker.
	let mut additional_library_candidate_paths = Vec::new();

	// Prepare to store wrapper arg values.
	let mut wrapper_arg_value = None;

	// Prepare to store wrapper env values.
	let mut wrapper_env_value = None;

	// Handle the arguments.
	while let Some(arg) = args.next() {
		if arg == "--" {
			command_args.push(arg);
			for arg in args {
				if is_library_candidate(&arg)
					&& let Ok(canonical_path) = std::fs::canonicalize(&arg)
				{
					additional_library_candidate_paths.push(canonical_path);
				}
				command_args.push(arg);
			}
			break;
		}

		// Consume only this proxy's options. Other components own other flags.
		match arg.as_str() {
			"--tangram-linker-passthrough" => {
				passthrough = true;
				continue;
			},
			"--tg-disallow-missing" => {
				disallow_missing = true;
				continue;
			},
			"--tg-embed-wrapper" => {
				embed = true;
				continue;
			},
			_ => {},
		}
		if let Some(option) = arg.strip_prefix("--tg-library-path-opt-level=") {
			library_path_optimization = LibraryPathStrategy::from_str(option).unwrap_or_default();
			continue;
		}
		if let Some(option) = arg.strip_prefix("--tg-max-depth=") {
			if let Ok(max_depth_arg) = option.parse() {
				max_depth = max_depth_arg;
			} else {
				tracing::warn!("Invalid max depth argument {option}. Using default.");
			}
			continue;
		}
		let (name, value) = arg
			.split_once('=')
			.map_or((arg.as_str(), None), |(name, value)| (name, Some(value)));
		if name == "--tangram-wrapper-arg-value" || name == "--tangram-wrapper-env-value" {
			let value = value
				.map(str::to_owned)
				.or_else(|| args.next())
				.ok_or_else(|| tg::error!(%name, "missing option value"))?;
			let value = value
				.parse::<tg::Value>()
				.map_err(|error| tg::error!(!error, %name, "failed to parse wrapper value"))?;
			if name == "--tangram-wrapper-arg-value" {
				let data = value
					.to_data()
					.try_unwrap_array()
					.map_err(|_| tg::error!("expected an array"))?
					.into_iter()
					.map(|v| {
						v.try_unwrap_template()
							.map_err(|_| tg::error!("expected a template"))
					})
					.collect::<tg::Result<Vec<_>>>()?;
				wrapper_arg_value.replace(data);
			} else {
				let data = value
					.try_unwrap_mutation()
					.map_err(|_| tg::error!("expected a mutation"))?
					.to_data();
				wrapper_env_value.replace(data);
			}
			continue;
		}
		command_args.push(arg.clone());

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
		if arg == "-L" || arg == "--library-path" {
			if let Some(library_path) = args.next() {
				command_args.push(library_path.clone());
				library_paths.push(library_path);
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
		command_path,
		command_args,
		disallow_missing,
		embed,
		interpreter_path,
		interpreter_args,
		injection_path,
		library_path_strategy: library_path_optimization,
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
			common::manifest::collect_dependencies_from_template_data(
				&common::template_from_artifact(path.directory.into()).to_data(),
				&mut dependencies,
			);
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
	let mut seen = HashMap::<_, tg::Directory, Hasher>::default();
	library_paths.retain(
		|path| match seen.entry((path.directory.id(), path.subpath.clone())) {
			std::collections::hash_map::Entry::Occupied(entry) => {
				let retained = entry.get();
				retained
					.state()
					.inherit_location(path.directory.state().location().as_ref());
				retained
					.state()
					.inherit_tokens(&path.directory.state().tokens());
				false
			},
			std::collections::hash_map::Entry::Vacant(entry) => {
				entry.insert(path.directory.clone());
				true
			},
		},
	);
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
		return Ok(Some(dir_with_subpath_from_directory(&root, subpath).await?));
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
	Ok(Some(dir_with_subpath_from_directory(&root, subpath).await?))
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
					.expect("TGLD_INTERPRETER_PATH must be set.");

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
				|dir_with_subpath| async move {
					let directory = dir_with_subpath.directory;
					let template = if let Some(subpath) = dir_with_subpath.subpath {
						common::template_from_artifact_and_subpath(directory.into(), subpath)
					} else {
						common::template_from_artifact(directory.into())
					};
					let data = template.to_data();
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
			let preloads = if let Some(path) = &options.injection_path {
				Some(vec![common::template_from_path(path).await?.to_data()])
			} else {
				None
			};
			let args = if let Some(value) = &options.interpreter_args {
				Some(
					common::interpreter_args(value, async |path| {
						common::template_from_path(path).await
					})
					.await?
					.into_iter()
					.map(|template| template.to_data())
					.collect(),
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
					let path = common::template_from_path(&path).await?.to_data();
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
					let path = common::template_from_path(&path).await?.to_data();
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
	let executable =
		common::manifest::Executable::Path(common::template_from_artifact(ld_output).to_data());

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
		let dir_with_subpath = dir_with_subpath_from_directory(&directory, None).await?;
		Some(dir_with_subpath)
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

	// Check out the library paths before searching their filesystem entries.
	let checkouts = checkout_library_paths(&library_paths).await?;

	// Find all the transitive needed libraries of the output file we can locate in the library path.
	find_transitive_needed_libraries(file, &checkouts, needed_libraries, max_depth, 0).await?;
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
		let dir_with_subpath = dir_with_subpath_from_directory(&directory, None).await?;
		isolated_library_paths.push(dir_with_subpath);
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
	let dir_with_subpath = dir_with_subpath_from_directory(&directory, None).await?;
	Ok(vec![dir_with_subpath])
}

/// Check out library paths and return their filesystem paths.
async fn checkout_library_paths(
	library_paths: &[DirectoryWithSubpath],
) -> tg::Result<Vec<(DirectoryWithSubpath, PathBuf)>> {
	if library_paths.is_empty() {
		return Ok(Vec::new());
	}
	let artifacts = library_paths
		.iter()
		.map(|path| path.directory.clone().into())
		.collect();
	let paths = common::checkout_artifacts(artifacts).await?;
	if paths.len() != library_paths.len() {
		return Err(tg::error!("expected one checkout path per library root"));
	}
	let checkouts = library_paths
		.iter()
		.cloned()
		.zip(paths)
		.map(|(library_path, path)| {
			let path = match &library_path.subpath {
				Some(subpath) => path.join(subpath),
				None => path,
			};
			(library_path, path)
		})
		.collect();

	Ok(checkouts)
}

/// Produce the set of library paths to be written to the wrapper post-optimization.
async fn finalize_library_paths<H: BuildHasher + Default>(
	disallow_missing: bool,
	library_paths: Vec<DirectoryWithSubpath>,
	needed_libraries: &HashMap<String, Option<DirectoryWithSubpath>, H>,
) -> tg::Result<Vec<DirectoryWithSubpath>> {
	let checkouts = checkout_library_paths(&library_paths).await?;

	// Warn or error if any required libraries are not included in the set.
	verify_missing_libraries(disallow_missing, needed_libraries, &checkouts).await?;
	Ok(library_paths)
}

/// Given a list of needed library names and a set of selected paths, report which libraries are not accounted for.
async fn verify_missing_libraries<H: BuildHasher + Default>(
	disallow_missing: bool,
	needed_libraries: &HashMap<String, Option<DirectoryWithSubpath>, H>,
	checkouts: &[(DirectoryWithSubpath, PathBuf)],
) -> tg::Result<()> {
	let mut found_libraries = HashSet::default();
	let basename = |library_name: &str| -> tg::Result<String> {
		let res = std::path::Path::new(&library_name)
			.file_stem()
			.and_then(|s| s.to_str())
			.ok_or_else(|| tg::error!("could not determine basename for library {library_name}"))?;
		Ok(res.to_owned())
	};

	// Read from the checkouts to avoid loading the directories again.
	let futures = checkouts.iter().map(|(library_path, path)| async move {
		let mut read_dir = tokio::fs::read_dir(path).await.map_err(
			|error| tg::error!(!error, directory = %library_path.directory.id(), path = %path.display(), "failed to read the checked out library path"),
		)?;
		let mut names = Vec::new();
		while let Some(entry) = read_dir.next_entry().await.map_err(
			|error| tg::error!(!error, path = %path.display(), "failed to read the library path's entries"),
		)? {
			names.push(entry.file_name().to_string_lossy().into_owned());
		}
		Ok::<_, tg::Error>(names)
	});
	let entries = futures::future::try_join_all(futures).await?;

	for library in needed_libraries.keys() {
		// For this check, we just care about the basename.
		let library_basename = basename(library)?;
		for names in &entries {
			for name in names {
				if name.starts_with(&library_basename) {
					let found_library_basename = basename(name)?;
					found_libraries.insert(found_library_basename);
					break;
				}
			}
		}
	}
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
		let library_paths = checkouts
			.iter()
			.map(|(library_path, _)| library_path)
			.collect_vec();
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
			let inner = dir_with_subpath.resolve().await?;
			dir_with_subpath_from_directory(&inner, None).await
		} else {
			Ok(dir_with_subpath.clone())
		}
	}))
	.await
}

/// Recursively find all needed libraries for an executable.
async fn find_transitive_needed_libraries<H: BuildHasher + Default + Send + Sync>(
	file: &tg::File,
	library_paths: &[(DirectoryWithSubpath, PathBuf)],
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

	for (dir_with_subpath, path) in library_paths {
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
			let library_path = path.join(&library_name);
			if !tokio::fs::try_exists(&library_path).await.unwrap_or(false) {
				continue;
			}
			let mut output = common::checkin_path(&library_path).await?;
			if matches!(output.artifact.node, tg::artifact::Id::Symlink(_)) {
				let target = std::fs::canonicalize(&library_path)
					.map_err(|error| tg::error!(!error, "failed to resolve the library symlink"))?;
				output = common::checkin_path(target).await?;
			}
			let artifact = tg::Artifact::with_referent(output.artifact);
			let Ok(found_library) = artifact.try_unwrap_file() else {
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

/// Get a [`DirectoryWithSubpath`] from a [`tg::Directory`] handle.
pub async fn dir_with_subpath_from_directory(
	directory: &tg::Directory,
	subpath: Option<PathBuf>,
) -> tg::Result<DirectoryWithSubpath> {
	directory.store().await?;
	Ok(DirectoryWithSubpath {
		directory: directory.clone(),
		subpath,
	})
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
			analyze_output_file, deduplicate_library_paths, library_path_needs_aliases,
		},
		tangram_client::prelude::*,
	};

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
		let first = tg::Directory::with_id(tg::directory::Id::new(b"first"));
		let duplicate = tg::Directory::with_id(first.id());
		let second = tg::Directory::with_id(tg::directory::Id::new(b"second"));
		for (directory, expires_at) in [(&first, 100), (&duplicate, 200)] {
			let token = tg::authorization::Token {
				body: tg::authorization::Body {
					expires_at,
					permissions: vec![tg::authorization::Permission::Object(
						tg::authorization::permission::object::Permission::Subtree,
					)],
					resource: directory.id().into(),
				},
				metadata: tg::authorization::Metadata {
					algorithm: tg::authorization::Algorithm::Ed25519,
					key: "test".into(),
				},
				signature: vec![0; 64],
			};
			directory
				.state()
				.set_tokens(tg::authorization::Tokens::with_local([token]));
		}
		// Keep an independent proof that the newer token does not cover.
		let mut complementary = first.state().tokens().local()[0].clone();
		complementary.metadata.key = "other-signer".into();
		first
			.state()
			.inherit_tokens(&tg::authorization::Tokens::with_local([
				complementary.clone()
			]));
		let newer = duplicate.state().tokens().local()[0].clone();
		let location = tg::Location::Remote(tg::location::Remote {
			name: "test".into(),
			region: None,
		});
		duplicate.state().set_location(Some(location.clone()));
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
		let tokens = paths[0].directory.state().tokens();
		assert_eq!(tokens.local().len(), 2);
		assert!(tokens.local().contains(&newer));
		assert!(tokens.local().contains(&complementary));
		assert_eq!(
			paths[0].directory.state().location(),
			Some(location.clone())
		);
		// Existing clones must observe the merged context on the first handle.
		assert_eq!(first.state().tokens(), tokens);
		assert_eq!(first.state().location(), Some(location));
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
