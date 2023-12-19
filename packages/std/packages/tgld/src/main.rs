use itertools::Itertools;
use std::{
	collections::HashSet,
	os::unix::fs::PermissionsExt,
	path::{Path, PathBuf},
};
use tangram_client as tg;
use tangram_error::Result;
use tangram_wrapper::manifest::{self, Manifest};
use tracing_subscriber::prelude::*;

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
		.expect("Failed to run the command.");

	// If the command did not exit successfully, then exit with its code.
	if !status.success() {
		let code = status.code().unwrap_or(1);
		std::process::exit(code);
	}

	// If passthrough mode is enabled, then exit.
	if options.passthrough {
		tracing::trace!("Passthrough mode enabled. Exiting.");
		return;
	}

	// If there is no file with the output path name, then exit.
	if !options.output_path.exists() {
		tracing::trace!("No output file found. Exiting.");
		return;
	}

	// Create the tangram instance.
	let runtime_json = std::env::var("TANGRAM_RUNTIME").expect("Failed to get TANGRAM_RUNTIME.");
	let tg = tg::client::Builder::with_runtime_json(&runtime_json)
		.expect("Could not create client.")
		.build();
	tg.connect().await.expect("Failed to connect to server.");

	// Analyze the output file.
	let AnalyzeOutputFileOutput {
		is_executable,
		interpreter,
		needed_libraries,
	} = analyze_output_file(&options.output_path);
	tracing::trace!(?is_executable, ?interpreter, ?needed_libraries,);

	let library_paths = if options.library_paths.is_empty() {
		None
	} else if options.combine_library_paths {
		// Produce a directory containing the libraries required by the output file found in the library paths.
		let combined_library_directory =
			create_combined_library_directory(&tg, &options.library_paths, &needed_libraries).await;
		Some(vec![combined_library_directory])
	} else {
		// Just unrender and resolve all paths found in the options.
		let library_paths = options
			.library_paths
			.iter()
			.map(|library_path| template_to_resolved_symlink(&tg, unrender(&tg, library_path)));
		let library_paths = futures::future::join_all(library_paths).await;
		Some(library_paths)
	};

	// Keep track of the references.
	let mut references = HashSet::default();

	// Handle an executable or a library.
	if is_executable {
		// If the linker generated an executable, then check it in and replace it with the wrapper with an embedded manifest.
		let file = tokio::fs::File::open(&options.output_path)
			.await
			.expect("Could not open output file");
		let blob = tg::Blob::with_reader(&tg, file)
			.await
			.expect("Could not create blob");
		let output_artifact = tg::File::builder(blob).executable(true).build();
		let output_artifact_id = output_artifact
			.id(&tg)
			.await
			.expect("Failed to get the output file id.")
			.clone()
			.try_into()
			.unwrap();

		// Copy the wrapper to the temporary path.
		let wrapper_path = options
			.wrapper_path
			.as_ref()
			.expect("TANGRAM_LINKER_WRAPPER_PATH must be set.");
		std::fs::remove_file(&options.output_path).ok();
		std::fs::copy(wrapper_path, &options.output_path)
			.expect("Failed to copy the wrapper file.");

		// Set the permissions of the wrapper file so we can write the manifest to the end.
		let mut perms = std::fs::metadata(&options.output_path)
			.expect("Failed to get the wrapper file metadata.")
			.permissions();
		perms.set_mode(0o755);
		std::fs::set_permissions(&options.output_path, perms)
			.expect("Failed to set the wrapper file permissions.");

		let manifest = create_manifest(
			&tg,
			output_artifact_id,
			&options,
			interpreter,
			library_paths,
		)
		.await;
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

// The options read from the environment and arguments.
#[derive(Debug)]
struct Options {
	/// Whether or not to combine the library paths filtering for needed libraries. Defaults to true.
	combine_library_paths: bool,

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
	let mut combine_library_paths = std::env::var("TANGRAM_LINKER_COMBINED_LIBRARY_PATH")
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
			if arg == "--tg-combined-library-paths=false" {
				combine_library_paths = false;
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
		combine_library_paths,
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

/// Create a manifest.
async fn create_manifest(
	tg: &dyn tg::Handle,
	ld_output_id: tg::artifact::Id,
	options: &Options,
	interpreter: Option<Option<String>>,
	library_paths: Option<Vec<tg::symlink::Data>>,
) -> Manifest {
	// Create the interpreter.
	let interpreter = if cfg!(target_os = "linux") {
		if let Some(interpreter) = interpreter {
			let (path, is_musl) = if let Some(path) = interpreter {
				// The executable had a non-default path explicitly stored. Use that.
				// We cannot determine whether the path provided was ld-linux or ld-musl. We assume it is ld-linux, as this interpreter type will work in either case.
				(path, false)
			} else {
				// The executable had a default path stored beginning with /lib. Use the default path provided to the proxy.
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

				(path.clone(), is_musl)
			};
			let path = unrender(tg, &path);
			let path = template_to_resolved_symlink(tg, path).await;
			tracing::trace!(?path, "Interpreter path");

			// Unrender the preloads.
			let mut preloads = None;
			if let Some(injection_path) = options.injection_path.as_deref() {
				preloads = Some(vec![
					template_to_resolved_symlink(tg, unrender(tg, injection_path)).await,
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
			// Static executables do not need an interpreter.
			None
		}
	} else if cfg!(target_os = "macos") {
		// Unrender the library paths.
		let library_paths = options
			.library_paths
			.iter()
			.map(|library_path| template_to_resolved_symlink(tg, unrender(tg, library_path)));
		let library_paths = Some(futures::future::join_all(library_paths).await);
		let mut preloads = None;
		if let Some(injection_path) = options.injection_path.as_deref() {
			preloads = Some(
				futures::future::join_all(std::iter::once(template_to_resolved_symlink(
					tg,
					unrender(tg, injection_path),
				)))
				.await,
			);
		}

		Some(manifest::Interpreter::DyLd(manifest::DyLdInterpreter {
			library_paths,
			preloads,
		}))
	} else {
		None
	};

	// Create the executable.
	let executable = manifest::Executable::Path(
		template_to_resolved_symlink(tg, async {
			tg::template::Data {
				components: vec![tg::template::component::Data::Artifact(ld_output_id)],
			}
		})
		.await,
	);

	// Create empty values for env and args.
	let env = None;
	let args = None;

	// Create the manifest.
	Manifest {
		identity: manifest::Identity::Wrapper,
		interpreter,
		executable,
		env,
		args,
	}
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
enum InterpreterRequirement {
	/// There is no interpreter needed to execute this file.
	None,
	/// Use the system default interpreter to execute this file.
	Default,
	/// Use the interpreter at the given path to execute this file.
	Path(String),
}

/// Analyze the command output file.
fn analyze_output_file(path: &Path) -> AnalyzeOutputFileOutput {
	// Read the file.
	let bytes = std::fs::read(path).unwrap_or_else(|_| {
		panic!(
			r#"Failed to read the output file at path "{}"."#,
			path.display()
		)
	});

	// Parse the object and analyze it.
	let object = goblin::Object::parse(&bytes).expect("Failed to parse output file as an object.");
	match object {
		// Handle an archive file.
		goblin::Object::Archive(_) => AnalyzeOutputFileOutput {
			is_executable: false,
			interpreter: None,
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
			let interpreter = if let Some(interpreter) = elf.interpreter {
				// If the interpreter starts with `/lib`, we'll use the default. Otherwise store the string path.
				let is_default = interpreter.starts_with("/lib");
				if is_default {
					None
				} else {
					Some(Some(interpreter.to_owned()))
				}
			} else if is_pie && !needed_libraries.is_empty() {
				Some(None)
			} else {
				None
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
					interpreter: Some(None),
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
					interpreter: Some(None),
					needed_libraries,
				}
			},
		},

		_ => panic!("Unsupported object type."),
	}
}

/// Create a directory containing the libraries required by the output file found in the library paths, and return it as a symlink with no subpath.
async fn create_combined_library_directory(
	tg: &dyn tg::Handle,
	library_paths: &[impl AsRef<Path>],
	needed_libraries: &[impl AsRef<str>],
) -> tg::symlink::Data {
	todo!()
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

async fn template_to_resolved_symlink<F>(tg: &dyn tg::Handle, template: F) -> tg::symlink::Data
where
	F: futures::Future<Output = tg::template::Data>,
{
	match template.await.components.as_slice() {
		[tg::template::component::Data::Artifact(id)] => tg::symlink::Data {
			artifact: Some(id.clone()),
			path: None,
		},
		[tg::template::component::Data::Artifact(artifact_id), tg::template::component::Data::String(s)] =>
		{
			// If there is a subpath, return the artifact it points to.
			let artifact = tg::Artifact::with_id(artifact_id.clone());
			if let tg::Artifact::Directory(directory) = artifact {
				let child = directory
					.entries(tg)
					.await
					.expect("Could not get directory entries")
					.get(s)
					.expect("Could not retrieve artifact at subpath");
				tg::symlink::Data {
					artifact: Some(child.id(tg).await.expect("Could not get child ID")),
					path: None,
				}
			} else {
				panic!("Expected a directory artifact.")
			}
		},
		_ => panic!("Expected a template with 1 or 2 components."),
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
	use super::{analyze_output_file, AnalyzeOutputFileOutput};

	#[test]
	fn read_output_files() {
		std::fs::write("main.c", "int main() { return 0; }").unwrap();

		// Test analyzing a shared library.
		std::process::Command::new("cc")
			.arg("main.c")
			.arg("-shared")
			.arg("-o")
			.arg("a.out")
			.status()
			.unwrap();
		let AnalyzeOutputFileOutput { is_executable, .. } = analyze_output_file("a.out".as_ref());
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
		} = analyze_output_file("a.out".as_ref());
		assert!(
			is_executable,
			"Dynamically linked executable was detected as a library."
		);
		assert!(
			interpreter.is_some(),
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
		} = analyze_output_file("a.out".as_ref());
		assert!(
			is_executable,
			"Statically linked executable was detected as a library."
		);
		assert!(
			interpreter.is_none(),
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
		} = analyze_output_file("a.out".as_ref());
		assert!(is_executable, "PIE was detected as a library.");
		assert!(interpreter.is_some(), "PIEs need an interpreter.");

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
		} = analyze_output_file("a.out".as_ref());
		assert!(
			is_executable,
			"Static-pie linked executable was detected as a library."
		);
		assert!(
			interpreter.is_none(),
			"Static-PIE linked executables do not need an interpreter."
		);

		std::fs::remove_file("a.out").ok();
		std::fs::remove_file("main.c").ok();
	}
}
