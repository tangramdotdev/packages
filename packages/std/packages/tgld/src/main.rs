use itertools::Itertools;
use std::{
	collections::{BTreeMap, HashMap, HashSet},
	hash::BuildHasher,
	os::unix::fs::PermissionsExt,
	path::PathBuf,
	str::FromStr,
};
use tangram_client as tg;
use tangram_error::{return_error, Result, WrapErr};
use tangram_wrapper::manifest::{self, Manifest};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncSeekExt};
use tracing_subscriber::prelude::*;

type Hasher = fnv::FnvBuildHasher;

#[tokio::main]
async fn main() {
	if let Err(e) = main_inner().await {
		eprintln!("linker proxy failed: {e}");
		let trace = e.trace();
		tracing::trace!("{trace}");
		std::process::exit(1);
	}
}

async fn main_inner() -> Result<()> {
	setup_tracing();

	// Read the options from the environment and arguments.
	let options = read_options();
	tracing::trace!(?options);

	// Run the command.
	let status = std::process::Command::new(&options.command_path)
		.args(&options.command_args)
		.status()
		.wrap_err("Failed to run the command")?;

	// If the command did not exit successfully, then exit with its code.
	if !status.success() {
		let code = status.code().unwrap_or(1);
		std::process::exit(code);
	}

	// If passthrough mode is enabled, then exit.
	if options.passthrough {
		tracing::trace!("Passthrough mode enabled. Exiting.");
		return Ok(());
	}

	// If there is no file with the output path name, then exit.
	if !options.output_path.exists() {
		tracing::trace!("No output file found. Exiting.");
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
	library_path_optimization: LibraryPathOptimizationStrategy,

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

	/// The output path.
	output_path: PathBuf,

	/// Whether the linker should run in passthrough mode.
	passthrough: bool,

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

	// Get the injection path.
	let injection_path = std::env::var("TANGRAM_LINKER_INJECTION_PATH").ok();

	// Get the option to disable combining library paths. Enabled by default.
	let mut library_optimization_strategy = std::env::var("TANGRAM_LINKER_LIBRARY_PATH_STRATEGY")
		.ok()
		.map_or(LibraryPathOptimizationStrategy::default(), |s| {
			s.parse().unwrap_or_default()
		});

	// Get an iterator over the arguments.
	let mut args = std::env::args();

	// Skip arg0.
	args.next();

	// Handle the arguments.
	while let Some(arg) = args.next() {
		// Pass through any arg that isn't a tangram arg.
		if arg.starts_with("--tg") {
			// Handle setting combined library paths. Will override the env var if set.
			if arg.starts_with("--tg-library-path-strategy=") {
				let option = arg
					.strip_prefix("--tg-library-path-strategy=")
					.expect("Invalid argument");
				library_optimization_strategy =
					LibraryPathOptimizationStrategy::from_str(option).unwrap_or_default();
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
		output_path,
		passthrough,
		wrapper_path,
	}
}

#[allow(clippy::too_many_lines)]
async fn create_wrapper(options: &Options) -> Result<()> {
	// Create the tangram instance.
	let runtime_json =
		std::env::var("TANGRAM_RUNTIME").wrap_err("Failed to get TANGRAM_RUNTIME.")?;
	let tg = tg::client::Builder::with_runtime_json(&runtime_json)?.build();
	tg.connect().await?;

	// Open the output file.
	let mut file = tokio::fs::File::open(&options.output_path)
		.await
		.wrap_err("Could not open output file")?;

	// Analyze the output file.
	let AnalyzeOutputFileOutput {
		is_executable,
		interpreter,
		needed_libraries: initial_needed_libraries,
	} = analyze_executable(
		file.try_clone()
			.await
			.wrap_err("Could not clone file handle")?,
	)
	.await?;
	tracing::trace!(?is_executable, ?interpreter, ?initial_needed_libraries);

	// Unrender all library paths to symlinks.
	let library_paths = options
		.library_paths
		.iter()
		.map(|library_path| template_data_to_symlink_data(unrender(&tg, library_path)));
	let library_paths = futures::future::try_join_all(library_paths).await?;
	tracing::trace!(?library_paths);

	// We need to obtain an artifact if the file is executable or we are creating a combined library directory.
	let output_artifact = if is_executable
		|| !matches!(
			options.library_path_optimization,
			LibraryPathOptimizationStrategy::None
		) {
		file.rewind()
			.await
			.wrap_err("Could not seek to beginning of output file.")?;
		let output_artifact = file_from_reader(&tg, file, is_executable).await?;
		let output_artifact_id = output_artifact.id(&tg).await?;
		tracing::trace!(?output_artifact_id, "Output artifact");
		Some(output_artifact)
	} else {
		None
	};

	let library_paths = if library_paths.is_empty() {
		None
	} else {
		// Set the initially known needed libraries.
		let mut needed_libraries: HashSet<String, Hasher> = HashSet::default();
		for library in &initial_needed_libraries {
			needed_libraries.insert(library.clone());
		}

		let mut library_paths =
			futures::future::try_join_all(library_paths.into_iter().map(|symlink_data| async {
				let object = tg::symlink::Object::try_from(symlink_data).unwrap();
				let symlink = tg::Symlink::with_object(object);
				let id = symlink.id(&tg).await?;
				Ok::<_, tangram_error::Error>(id.clone())
			}))
			.await?
			.into_iter()
			.collect::<HashSet<_, Hasher>>();
		let strategy = options.library_path_optimization;
		tracing::trace!(
			?library_paths,
			?needed_libraries,
			?strategy,
			"pre-optimize library paths"
		);

		optimize_library_paths(
			&tg,
			&output_artifact,
			&mut library_paths,
			&mut needed_libraries,
			options.library_path_optimization,
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
			.wrap_err("TANGRAM_LINKER_WRAPPER_PATH must be set.")?;
		std::fs::remove_file(&options.output_path).ok();
		std::fs::copy(wrapper_path, &options.output_path)
			.wrap_err("Failed to copy the wrapper file.")?;

		// Set the permissions of the wrapper file so we can write the manifest to the end.
		let mut perms = std::fs::metadata(&options.output_path)
			.expect("Failed to get the wrapper file metadata.")
			.permissions();
		perms.set_mode(0o755);
		std::fs::set_permissions(&options.output_path, perms)
			.expect("Failed to set the wrapper file permissions.");

		let manifest =
			create_manifest(&tg, output_artifact_id, options, interpreter, library_paths).await?;
		tracing::trace!(?manifest);

		// Write the manifest.
		manifest
			.write(&options.output_path)
			.expect("Failed to write the manifest.");

		// Get the manifest's references.
		references = manifest.references();
	} else {
		// Otherwise, if the linker generated a library, then add its references.
		if let Some(library_paths) = library_paths {
			references.reserve(library_paths.len());
			for library_path in &library_paths {
				references.insert(library_path.clone().into());
			}
			tracing::trace!(?references);
		}
	}

	// Set the xattrs of the output file.
	let attributes = tg::file::Attributes {
		references: references.into_iter().collect(),
	};
	let attributes =
		serde_json::to_string(&attributes).expect("Failed to serialize the attributes.");
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

				// Check if this is a musl interpreter.  Follow the symlink, get the pathname.
				let is_musl = {
					let canonical_interpreter = std::fs::canonicalize(path)
						.expect("Failed to canonicalize the interpreter path.");
					// Canonicalizing the musl interpreter will resolve to libc.so.  We check that the filename does NOT contain "ld-linux".
					!canonical_interpreter
						.file_name()
						.expect("Failed to read the interpreter file name")
						.to_str()
						.expect("Invalid interpreter file name")
						.contains("ld-linux")
				};

				Some((path.clone(), is_musl))
			},
			InterpreterRequirement::Path(path) => Some((path, false)),
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

		if let Some((path, is_musl)) = config {
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

			if is_musl {
				Some(manifest::Interpreter::LdMusl(manifest::LdMuslInterpreter {
					path,
					library_paths,
					preloads,
					args,
				}))
			} else {
				Some(manifest::Interpreter::LdLinux(
					manifest::LdLinuxInterpreter {
						path,
						library_paths,
						preloads,
						args,
					},
				))
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
enum LibraryPathOptimizationStrategy {
	/// Do not optimize library paths.
	#[default]
	None,
	/// Combine library paths into a single directory.
	Combine,
	/// Filter library paths for needed libraries.
	Filter,
}

impl std::str::FromStr for LibraryPathOptimizationStrategy {
	type Err = tangram_error::Error;

	fn from_str(s: &str) -> Result<Self, Self::Err> {
		match s.to_ascii_lowercase().as_str() {
			"none" => Ok(Self::None),
			"combine" => Ok(Self::Combine),
			"filter" => Ok(Self::Filter),
			_ => return_error!("Invalid library path optimization strategy {s}."),
		}
	}
}

#[tracing::instrument(skip(tg, file))]
async fn optimize_library_paths<H: BuildHasher + Default + Send + Sync>(
	tg: &dyn tg::Handle,
	file: &Option<tg::File>,
	library_paths: &mut HashSet<tg::symlink::Id, H>,
	needed_libraries: &mut HashSet<String, H>,
	strategy: LibraryPathOptimizationStrategy,
) -> Result<()> {
	if file.is_none()
		|| matches!(strategy, LibraryPathOptimizationStrategy::None)
		|| library_paths.is_empty()
	{
		return Ok(());
	}

	// Find all the transitive needed libraries of the output file we can locate in the library path.
	let file = file.as_ref().unwrap();
	let mut selected_paths = HashMap::default();
	find_transitive_needed_libraries(
		tg,
		file,
		library_paths,
		needed_libraries,
		&mut selected_paths,
	)
	.await?;
	tracing::trace!(?needed_libraries, ?selected_paths);

	match strategy {
		LibraryPathOptimizationStrategy::None => unreachable!(),
		LibraryPathOptimizationStrategy::Combine => {
			let mut entries: BTreeMap<String, tg::Artifact> = BTreeMap::default();
			for (symlink_id, _) in selected_paths {
				let symlink = tg::Symlink::with_id(symlink_id.clone());
				entries.insert(symlink_id.to_string(), symlink.into());
			}
			let combined_library_directory = tg::directory::Builder::new(entries).build();
			let combined_library_directory =
				tg::Symlink::new(Some(combined_library_directory.into()), None);
			library_paths.clear();
			library_paths.insert(combined_library_directory.id(tg).await?.clone());
		},
		LibraryPathOptimizationStrategy::Filter => {
			// The selected paths already contain the subset of paths we need.
			let selected_paths = futures::future::try_join_all(
				selected_paths
					.into_keys()
					.map(|id| async move { Ok::<_, tangram_error::Error>(id.clone()) }),
			)
			.await?;
			tracing::trace!(?selected_paths);
			library_paths.clear();
			for symlink_id in selected_paths {
				library_paths.insert(symlink_id.clone());
			}
		},
	}
	tracing::trace!(?library_paths, "post-optimize");

	// Check which libraries we found against which libraries we needed. Anything missing will need to be supplied separately at runtime.
	let mut found_libraries = HashSet::default();
	for library in needed_libraries.iter() {
		for library_path in library_paths.iter() {
			let symlink = tg::Symlink::with_id(library_path.clone());
			let artifact = symlink
				.artifact(tg)
				.await?
				.as_ref()
				.ok_or(tangram_error::Error::with_message("Expected a directory."))?;
			if let tg::Artifact::Directory(directory) = artifact {
				if directory.entries(tg).await?.contains_key(library) {
					found_libraries.insert(library.clone());
					continue;
				}
			}
		}
	}
	let missing_libs = needed_libraries.difference(&found_libraries).collect_vec();
	if !missing_libs.is_empty() {
		tracing::warn!("Could not find the following libraries, they will be required at runtime: {missing_libs:?}");
	}

	Ok(())
}

#[async_recursion::async_recursion]
#[tracing::instrument(skip(tg, file))]
async fn find_transitive_needed_libraries<H: BuildHasher + Default + Send + Sync>(
	tg: &dyn tg::Handle,
	file: &tg::File,
	library_paths: &HashSet<tg::symlink::Id, H>,
	all_needed_libraries: &mut HashSet<String, H>,
	selected_paths: &mut HashMap<tg::symlink::Id, Vec<String>, H>,
) -> Result<()> {
	// Check if we're done.
	if all_needed_libraries.is_empty() || found_all_libraries(all_needed_libraries, selected_paths)
	{
		return Ok(());
	}

	let reader = file.reader(tg).await?;
	let AnalyzeOutputFileOutput {
		needed_libraries, ..
	} = analyze_executable(reader).await?;
	for library in &needed_libraries {
		all_needed_libraries.insert(library.clone());
	}

	for symlink_id in library_paths {
		let symlink = tg::Symlink::with_id(symlink_id.clone());
		if let Ok(Some(tg::Artifact::Directory(directory))) = symlink.resolve(tg).await {
			tracing::trace!(?directory, "Checking directory for libraries.");
			let copy = all_needed_libraries.iter().cloned().collect_vec();
			for library_name in copy {
				let found_library = match directory
					.try_get(
						tg,
						&tg::Path::from_str(&library_name).wrap_err("Could not create path")?,
					)
					.await?
				{
					Some(tg::Artifact::Directory(_)) | None => None,
					Some(tg::Artifact::File(file)) => Some(file.clone()),
					Some(tg::Artifact::Symlink(found_symlink)) => {
						let found_symlink_id = found_symlink.id(tg).await?;
						tracing::trace!(?found_symlink_id, ?library_name, "Found library symlink.");
						let from = symlink.clone();
						if let Some(tg::Artifact::File(found_library)) =
							found_symlink.resolve_from(tg, Some(from)).await?
						{
							Some(found_library)
						} else {
							tracing::warn!("Could not resolve symlink {found_symlink_id}.");
							None
						}
					},
				};
				tracing::trace!(
					?found_library,
					?library_name,
					"Checking if library is needed."
				);
				if let Some(found_library) = found_library {
					let symlink = tg::Symlink::new(Some(directory.clone().into()), None);
					let id = symlink.id(tg).await?;
					selected_paths
						.entry(id.clone())
						.or_insert_with(|| Vec::with_capacity(1))
						.push(library_name.clone());
					tracing::trace!(?found_library, ?library_name, "Found library file.");
					find_transitive_needed_libraries(
						tg,
						&found_library,
						library_paths,
						all_needed_libraries,
						selected_paths,
					)
					.await?;
					if found_all_libraries(all_needed_libraries, selected_paths) {
						return Ok(());
					}
				}
			}
		}
	}

	Ok(())
}

#[tracing::instrument]
fn found_all_libraries<H: BuildHasher + Default>(
	all_needed_libraries: &HashSet<String, H>,
	selected_paths: &HashMap<tg::symlink::Id, Vec<String>, H>,
) -> bool {
	let found_libraries = selected_paths
		.iter()
		.fold(HashSet::default(), |mut acc, (_, v)| {
			for library in v {
				acc.insert(library.clone());
			}
			acc
		});
	found_libraries.is_superset(all_needed_libraries)
}

/// Analyze an output file.
#[cfg(test)]
async fn analyze_output_file(path: impl AsRef<std::path::Path>) -> Result<AnalyzeOutputFileOutput> {
	let file = tokio::fs::File::open(&path).await.wrap_err_with(|| {
		format!(
			r#"Failed to open the output file at path "{}"."#,
			path.as_ref().display()
		)
	})?;
	analyze_executable(file).await
}

/// Analyze an executable.
async fn analyze_executable(mut reader: impl AsyncRead + Unpin) -> Result<AnalyzeOutputFileOutput> {
	// Collect the bytes.
	let mut bytes = Vec::new();
	reader
		.read_to_end(&mut bytes)
		.await
		.wrap_err("Failed to read the output file.")?;

	// Parse the object and analyze it.
	let object =
		goblin::Object::parse(&bytes).wrap_err("Failed to parse output file as an object.")?;
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

async fn file_from_reader(
	tg: &dyn tg::Handle,
	reader: impl AsyncRead + Unpin,
	is_executable: bool,
) -> Result<tg::File> {
	let blob = tg::Blob::with_reader(tg, reader)
		.await
		.wrap_err("Could not create blob")?;
	let file = tg::File::builder(blob).executable(is_executable).build();
	Ok(file)
}

fn setup_tracing() {
	// Create the env layer.
	let tracing_env_filter = std::env::var("TGLD_TRACING").ok();
	let env_layer = tracing_env_filter
		.map(|env_filter| tracing_subscriber::filter::EnvFilter::try_new(env_filter).unwrap());

	// If tracing is enabled, then create and initialize the subscriber.
	if let Some(env_layer) = env_layer {
		let format_layer = tracing_subscriber::fmt::layer()
			.compact()
			.with_span_events(tracing_subscriber::fmt::format::FmtSpan::NEW)
			.with_writer(std::io::stderr);
		let subscriber = tracing_subscriber::registry()
			.with(env_layer)
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
		[tg::template::component::Data::Artifact(id)] => Ok(tg::symlink::Data {
			artifact: Some(id.clone()),
			path: None,
		}),
		[tg::template::component::Data::Artifact(artifact_id), tg::template::component::Data::String(s)] => {
			Ok(tg::symlink::Data {
				artifact: Some(artifact_id.clone()),
				path: Some(s.strip_prefix('/').unwrap().to_owned()),
			})
		},
		_ => {
			return_error!(
				"Expected a template with 1 or 2 components, got {:?}.",
				components
			)
		},
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
