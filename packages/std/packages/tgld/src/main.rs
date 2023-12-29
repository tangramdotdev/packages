use itertools::Itertools;
use std::{
	collections::{BTreeMap, HashSet},
	os::unix::fs::PermissionsExt,
	path::PathBuf,
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
	/// Whether or not to combine the library paths filtering for needed libraries. Defaults to true.
	combined_library_path: bool,

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
	let mut combined_library_path = std::env::var("TANGRAM_LINKER_COMBINED_LIBRARY_PATH")
		.ok()
		.map_or(true, |s| s == "1");

	// Get an iterator over the arguments.
	let mut args = std::env::args();

	// Skip arg0.
	args.next();

	// Handle the arguments.
	while let Some(arg) = args.next() {
		// Pass through any arg that isn't a tangram arg.
		if arg.starts_with("--tg") {
			// Handle setting combined library paths. Will override the env var if set.
			if arg == "--tg-combined-library-path=false" {
				combined_library_path = false;
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
		combined_library_path,
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
		..
	} = analyze_executable(
		file.try_clone()
			.await
			.wrap_err("Could not clone file handle")?,
	)
	.await?;
	tracing::trace!(?is_executable, ?interpreter);

	// Unrender and resolve all library paths.
	let library_paths = options
		.library_paths
		.iter()
		.map(|library_path| template_data_to_symlink_data(&tg, unrender(&tg, library_path)));
	let library_paths = futures::future::try_join_all(library_paths).await?;

	// We need to obtain an artifact if the file is executable or we are creating a combined library directory.
	let output_artifact = if is_executable || options.combined_library_path {
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

	// Produce a combined library directory if needed and create the manifest value.
	let library_paths = if options.library_paths.is_empty() {
		None
	} else if options.combined_library_path {
		let output_artifact = output_artifact.as_ref().unwrap();
		// Produce a directory containing the libraries required by the output file found in the library paths.
		let combined_library_directory =
			create_combined_library_directory(&tg, output_artifact, &library_paths).await?;
		Some(vec![combined_library_directory])
	} else {
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
		references.reserve(options.library_paths.len());
		for library_path in &options.library_paths {
			let template = unrender(&tg, library_path).await;
			tangram_wrapper::manifest::collect_references_from_template_data(
				&template,
				&mut references,
			);
		}
		tracing::trace!(?references);
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
async fn create_manifest(
	tg: &dyn tg::Handle,
	ld_output_id: tg::artifact::Id,
	options: &Options,
	interpreter: InterpreterRequirement,
	library_paths: Option<Vec<tg::symlink::Data>>,
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

		if let Some((path, is_musl)) = config {
			// Unrender the interpreter path.
			let path = unrender(tg, &path);
			let path = template_data_to_symlink_data(tg, path).await?;
			tracing::trace!(?path, "Interpreter path");

			// Unrender the preloads.
			let mut preloads = None;
			if let Some(injection_path) = options.injection_path.as_deref() {
				preloads = Some(vec![
					template_data_to_symlink_data(tg, unrender(tg, injection_path)).await?,
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
			.map(|library_path| template_data_to_symlink_data(tg, unrender(tg, library_path)));
		let library_paths = Some(futures::future::try_join_all(library_paths).await?);
		let mut preloads = None;
		if let Some(injection_path) = options.injection_path.as_deref() {
			preloads = Some(
				futures::future::try_join_all(std::iter::once(template_data_to_symlink_data(
					tg,
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

/// Create a directory containing the libraries required by the output file found in the library paths, and return it as a symlink with no subpath.
async fn create_combined_library_directory(
	tg: &dyn tg::Handle,
	file: &tg::File,
	library_paths: &[tg::symlink::Data],
) -> Result<tg::symlink::Data> {
	let mut found_libraries: BTreeMap<String, tg::Artifact> = BTreeMap::default();
	locate_needed_libraries(tg, file, library_paths, &mut found_libraries).await?;
	let directory = tg::Artifact::Directory(tg::Directory::new(found_libraries));
	let symlink = tg::Symlink::new(Some(directory), None);
	let data = symlink.data(tg).await?;
	Ok(data)
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

#[async_recursion::async_recursion]
async fn locate_needed_libraries(
	tg: &dyn tg::Handle,
	file: &tg::File,
	library_paths: &[tg::symlink::Data],
	found_libraries: &mut BTreeMap<String, tg::Artifact>,
) -> Result<()> {
	let reader = file.reader(tg).await?;
	let AnalyzeOutputFileOutput {
		mut needed_libraries,
		..
	} = analyze_executable(reader).await?;

	for symlink_data in library_paths {
		needed_libraries.retain(|library_name| !found_libraries.contains_key(library_name));
		if needed_libraries.is_empty() {
			return Ok(());
		}
		let object = tg::symlink::Object::try_from(symlink_data.clone())?;
		let symlink = tg::Symlink::with_object(object);
		if let Ok(Some(tg::Artifact::Directory(directory))) = symlink.resolve(tg).await {
			let entries = directory.entries(tg).await?;
			for library_name in &needed_libraries {
				if let Some(tg::Artifact::File(found_library)) = entries.get(library_name) {
					tracing::trace!(?found_library, ?library_name, "Found library.");
					found_libraries.insert(
						library_name.to_owned(),
						tg::Artifact::File(found_library.clone()),
					);
					locate_needed_libraries(tg, found_library, library_paths, found_libraries)
						.await?;
				};
			}
		}
	}
	Ok(())
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

async fn template_data_to_symlink_data<F>(
	tg: &dyn tg::Handle,
	template: F,
) -> Result<tg::symlink::Data>
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
		[tg::template::component::Data::Artifact(artifact_id), tg::template::component::Data::String(s)] =>
		{
			// If there is a subpath, return the artifact it points to.
			let data = tg::symlink::Data {
				artifact: Some(artifact_id.clone()),
				path: Some(s.strip_prefix('/').unwrap().to_owned()),
			};
			let object = tg::symlink::Object::try_from(data.clone())?;
			let symlink = tg::Symlink::with_object(object);
			if let Ok(Some(target)) = symlink.resolve(tg).await {
				Ok(tg::symlink::Data {
					artifact: Some(target.id(tg).await?.clone()),
					path: None,
				})
			} else {
				Ok(tg::symlink::Data {
					artifact: None,
					path: None,
				})
			}
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
