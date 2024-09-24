use std::{collections::BTreeMap, ffi::OsStr, os::unix::process::CommandExt, path::PathBuf};
use tangram_client as tg;
use tangram_std::manifest;

fn main() {
	if let Err(e) = main_inner() {
		eprintln!("wrapper failed: {e}");
		std::process::exit(1);
	}
}

#[allow(clippy::too_many_lines)]
fn main_inner() -> std::io::Result<()> {
	// Setup tracing.
	#[cfg(feature = "tracing")]
	tangram_std::tracing::setup("TANGRAM_WRAPPER_TRACING");

	// Get the wrapper path.
	let wrapper_path = std::env::current_exe()?.canonicalize()?;
	#[cfg(feature = "tracing")]
	tracing::trace!(?wrapper_path);

	// Read the manifest.
	let manifest =
		tangram_std::Manifest::read_from_path(&wrapper_path)?.expect("Malformed manifest.");

	// Search args for known flags.
	let mut suppress_args = false;
	let mut suppress_env = false;
	let args_os = std::env::args_os();
	let num_args = args_os.len();
	let mut filtered_args = Vec::with_capacity(num_args);
	for arg in args_os {
		if arg == "--tangram-print-manifest" {
			println!("{}", serde_json::to_string_pretty(&manifest).unwrap());
			return Ok(());
		} else if arg == "--tangram-wrapper-suppress-args" {
			suppress_args = true;
		} else if arg == "--tangram-wrapper-suppress-env" {
			suppress_env = true;
		} else {
			filtered_args.push(arg);
		}
	}

	// Check env vars for known flags.
	if !suppress_args && std::env::var("TANGRAM_WRAPPER_SUPPRESS_ARGS").is_ok() {
		suppress_args = true;
	}
	if !suppress_env && std::env::var("TANGRAM_WRAPPER_SUPPRESS_ENV").is_ok() {
		suppress_env = true;
	}

	// Get the artifacts directories.
	let artifacts_directories = locate_artifacts_directories(&wrapper_path);
	#[cfg(feature = "tracing")]
	tracing::debug!(?artifacts_directories);

	// Get arg0 from the invocation.
	let arg0 = &filtered_args[0];

	// Render the interpreter.
	let interpreter = handle_interpreter(
		&manifest.interpreter,
		arg0.as_os_str(),
		&artifacts_directories,
	)?;
	let interpreter_path = interpreter.as_ref().map(|(path, _)| path).cloned();
	#[cfg(feature = "tracing")]
	tracing::debug!(?interpreter_path);

	// Render the executable.
	let executable_path = match &manifest.executable {
		manifest::Executable::Path(file) => PathBuf::from(file.clone()),
		manifest::Executable::Content(template) => {
			content_executable(&render_template(template, &artifacts_directories))?
		},
	};
	#[cfg(feature = "tracing")]
	tracing::debug!(?executable_path);

	// Choose the identity path.
	let identity_path = match &manifest.identity {
		manifest::Identity::Wrapper => wrapper_path,
		manifest::Identity::Interpreter => interpreter_path.expect("If the manifest specifies the interpreter as its identity, then the manifest must contain an interpreter."),
		manifest::Identity::Executable => executable_path.clone(),
	};
	#[cfg(feature = "tracing")]
	tracing::debug!(?identity_path);

	// Create the command.
	let mut command = if let Some((interpreter_path, interpreter_args)) = interpreter {
		#[cfg(feature = "tracing")]
		tracing::trace!(?interpreter_path);
		#[cfg(feature = "tracing")]
		tracing::trace!(?interpreter_args);
		#[cfg(feature = "tracing")]
		tracing::trace!(?executable_path);
		let mut command = std::process::Command::new(interpreter_path);
		command.args(interpreter_args);
		command.arg(executable_path);
		command
	} else {
		#[cfg(feature = "tracing")]
		tracing::trace!(?executable_path);
		std::process::Command::new(executable_path)
	};

	// Set the env.
	if !suppress_env {
		if let Some(env) = &manifest.env {
			mutate_env(env, &artifacts_directories);
		}
	}

	// Set `TANGRAM_INJECTION_IDENTITY_PATH` if necessary.
	if let Some(
		manifest::Interpreter::LdLinux(_)
		| manifest::Interpreter::LdMusl(_)
		| manifest::Interpreter::DyLd(_),
	) = &manifest.interpreter
	{
		// Set `TANGRAM_INJECTION_IDENTITY_PATH`.
		std::env::set_var("TANGRAM_INJECTION_IDENTITY_PATH", identity_path);
	}

	// Set interpreter environment variables if necessary.
	if let Some(manifest::Interpreter::DyLd(interpreter)) = &manifest.interpreter {
		set_dyld_environment(interpreter);
	}

	// Forward arg 0.
	command.arg0(arg0);

	// Add the args.
	if !suppress_args {
		if let Some(args) = manifest.args {
			let command_args = args
				.iter()
				.map(|arg| render_template(arg, &artifacts_directories))
				.collect::<Vec<_>>();
			#[cfg(feature = "tracing")]
			tracing::trace!(?command_args);
			command.args(command_args);
		}
	}

	// Add the wrapper args.
	let wrapper_args = &filtered_args[1..];
	#[cfg(feature = "tracing")]
	tracing::trace!(?wrapper_args);
	command.args(wrapper_args);

	// Exec the command.
	#[cfg(feature = "tracing")]
	tracing::trace!(?command);
	Err(command.exec())
}

/// Unset all currently set env vars.
fn clear_env() {
	std::env::vars().for_each(|(key, _)| std::env::remove_var(key));
}

/// Create a temporary file with the given contents and return the path to the file.
fn content_executable(contents: &str) -> std::io::Result<PathBuf> {
	let fd = unsafe {
		// Create a temporary file.
		let temp_path = c"/tmp/XXXXXX".to_owned();
		let fd = libc::mkstemp(temp_path.as_ptr().cast_mut());
		if fd == -1 {
			#[cfg(feature = "tracing")]
			tracing::error!(?temp_path, "Failed to create temporary file.");
			return Err(std::io::Error::last_os_error());
		}

		// Unlink the temporary file.
		let ret = libc::unlink(temp_path.as_ptr());
		if ret == -1 {
			#[cfg(feature = "tracing")]
			tracing::error!(?temp_path, "Failed to unlink temporary file.");
			return Err(std::io::Error::last_os_error());
		}

		// Write the contents to the temporary file.
		let mut written = 0;
		while written < contents.len() {
			let slice = &contents[written..];
			let ret = libc::write(fd, slice.as_ptr().cast(), slice.len());
			if ret == -1 {
				#[cfg(feature = "tracing")]
				tracing::error!(?temp_path, "Failed to write to temporary file.");
				return Err(std::io::Error::last_os_error());
			}
			#[allow(clippy::cast_sign_loss)]
			let ret: usize = if ret >= 0 { ret as usize } else { 0 };
			written += ret;
		}

		// Seek to the beginning of the temporary file.
		let ret = libc::lseek(fd, 0, libc::SEEK_SET);
		if ret == -1 {
			#[cfg(feature = "tracing")]
			tracing::error!(
				?temp_path,
				"Failed to seek to the beginning of the temporary file."
			);
			return Err(std::io::Error::last_os_error());
		}
		fd
	};

	// Create a path to the temporary file.
	Ok(PathBuf::from(format!("/dev/fd/{fd}")))
}

fn locate_artifacts_directories(path: impl AsRef<std::path::Path>) -> Vec<PathBuf> {
	let mut ret = vec![];
	for path in path.as_ref().ancestors().skip(1) {
		let directory = path.join(".tangram/artifacts");
		if directory.exists() {
			ret.push(directory);
		}
	}
	ret
}

#[allow(clippy::too_many_lines)]
fn handle_interpreter(
	interpreter: &Option<manifest::Interpreter>,
	arg0: &OsStr,
	artifacts_directories: &[impl AsRef<std::path::Path>],
) -> Result<Option<(PathBuf, Vec<String>)>, std::io::Error> {
	let result = match interpreter {
		// Handle a normal interpreter.
		Some(manifest::Interpreter::Normal(interpreter)) => {
			let interpreter_path = interpreter.path.render();
			let interpreter_path = PathBuf::from(interpreter_path).canonicalize()?;
			let interpreter_args = interpreter
				.args
				.iter()
				.map(|arg| render_template(arg, artifacts_directories))
				.collect();
			Some((interpreter_path, interpreter_args))
		},

		// Handle an ld-linux interpreter.
		Some(manifest::Interpreter::LdLinux(interpreter)) => {
			// Render the interpreter path.
			let interpreter_path = interpreter.path.render();

			// Canonicalize the interpreter path.
			let interpreter_path = PathBuf::from(interpreter_path).canonicalize()?;

			// Initialize the interpreter arguments.
			let mut interpreter_args = vec![];

			// Inhibit reading from /etc/ld.so.cache.
			interpreter_args.push("--inhibit-cache".to_owned());

			// Render the interpreter library path and the library paths.
			let mut library_path = interpreter
				.library_paths
				.iter()
				.flatten()
				.map(tangram_std::manifest::ArtifactPath::render)
				.collect::<Vec<_>>()
				.join(":");

			// Prepend any paths found in LD_LIBRARY_PATH.
			if let Ok(ld_library_path) = std::env::var("LD_LIBRARY_PATH") {
				library_path = format!("{ld_library_path}:{library_path}");
			}

			#[cfg(feature = "tracing")]
			tracing::trace!(?library_path);
			interpreter_args.push("--library-path".to_owned());
			interpreter_args.push(library_path);

			// Render the preloads.
			if let Some(preloads) = &interpreter.preloads {
				let preload = preloads
					.iter()
					.map(tangram_std::manifest::ArtifactPath::render)
					.collect::<Vec<_>>()
					.join(":");
				#[cfg(feature = "tracing")]
				tracing::trace!(?preload);
				interpreter_args.push("--preload".to_owned());
				interpreter_args.push(preload);
			}

			// Add the additional interpreter args.
			if let Some(additional_args) = &interpreter.args {
				interpreter_args.extend(
					additional_args
						.iter()
						.map(|arg| render_template(arg, artifacts_directories)),
				);
			}

			// Forward argv0.
			interpreter_args.push("--argv0".to_owned());
			interpreter_args.push(arg0.to_str().unwrap().to_owned());

			Some((interpreter_path, interpreter_args))
		},

		// Handle an ld-musl interpreter.
		Some(manifest::Interpreter::LdMusl(interpreter)) => {
			// Render the interpreter path.
			let interpreter_path = interpreter.path.render();

			// Canonicalize the interpreter path.
			#[cfg(feature = "tracing")]
			tracing::debug!(
				?interpreter_path,
				"rendered ld-musl interpreter path string"
			);
			let interpreter_path = PathBuf::from(interpreter_path).canonicalize()?;
			#[cfg(feature = "tracing")]
			tracing::debug!(
				?interpreter_path,
				"canonicalized ld-musl interpreter path string"
			);

			// Initialize the interpreter arguments.
			let mut interpreter_args = vec![];

			// Render the interpreter library path and the library paths.
			let mut library_path = interpreter
				.library_paths
				.iter()
				.flatten()
				.map(tangram_std::manifest::ArtifactPath::render)
				.collect::<Vec<_>>()
				.join(":");

			// Prepend any paths found in LD_LIBRARY_PATH.
			if let Ok(ld_library_path) = std::env::var("LD_LIBRARY_PATH") {
				library_path = format!("{ld_library_path}:{library_path}");
			}

			#[cfg(feature = "tracing")]
			tracing::trace!(?library_path);
			interpreter_args.push("--library-path".to_owned());
			interpreter_args.push(library_path);

			// Render the preloads.
			if let Some(preloads) = &interpreter.preloads {
				let preload = preloads
					.iter()
					.map(tangram_std::manifest::ArtifactPath::render)
					.collect::<Vec<_>>()
					.join(":");
				#[cfg(feature = "tracing")]
				tracing::trace!(?preload);
				interpreter_args.push("--preload".to_owned());
				interpreter_args.push(preload);
			}

			// Add the additional interpreter args.
			if let Some(additional_args) = &interpreter.args {
				interpreter_args.extend(
					additional_args
						.iter()
						.map(|arg| render_template(arg, artifacts_directories)),
				);
			}

			// Forward argv0.
			interpreter_args.push("--argv0".to_owned());
			interpreter_args.push(arg0.to_str().unwrap().to_owned());

			Some((interpreter_path, interpreter_args))
		},

		// Handle a dyld interpreter or no interpreter.
		Some(manifest::Interpreter::DyLd(_)) | None => None,
	};
	Ok(result)
}

fn set_dyld_environment(interpreter: &manifest::DyLdInterpreter) {
	// Set `TANGRAM_INJECTION_DYLD_LIBRARY_PATH`.
	if let Some(library_paths) = &interpreter.library_paths {
		let mut user_library_path = None;
		if let Ok(dyld_library_path) = std::env::var("DYLD_LIBRARY_PATH") {
			std::env::set_var("TANGRAM_INJECTION_DYLD_LIBRARY_PATH", &dyld_library_path);
			user_library_path = Some(dyld_library_path);
		} else {
			std::env::remove_var("TANGRAM_INJECTION_DYLD_LIBRARY_PATH");
		}
		let manifest_library_path = library_paths
			.iter()
			.map(tangram_std::manifest::ArtifactPath::render)
			.collect::<Vec<_>>()
			.join(":");
		let library_path = if let Some(dyld_library_path) = user_library_path {
			format!("{dyld_library_path}:{manifest_library_path}")
		} else {
			manifest_library_path
		};
		#[cfg(feature = "tracing")]
		tracing::trace!(?library_path);
		std::env::set_var("DYLD_LIBRARY_PATH", library_path);
	}

	// Set `TANGRAM_INJECTION_DYLD_INSERT_LIBRARIES`.
	if let Some(preloads) = &interpreter.preloads {
		if let Ok(dyld_insert_libraries) = std::env::var("DYLD_INSERT_LIBRARIES") {
			std::env::set_var(
				"TANGRAM_INJECTION_DYLD_INSERT_LIBRARIES",
				dyld_insert_libraries,
			);
		} else {
			std::env::remove_var("TANGRAM_INJECTION_DYLD_INSERT_LIBRARIES");
		}
		let insert_libraries = preloads
			.iter()
			.map(tangram_std::manifest::ArtifactPath::render)
			.collect::<Vec<_>>()
			.join(":");
		std::env::set_var("DYLD_INSERT_LIBRARIES", insert_libraries);
	}
}

fn mutate_env(env: &tg::mutation::Data, artifacts_directories: &[impl AsRef<std::path::Path>]) {
	match env {
		tg::mutation::Data::Unset => {
			clear_env();
		},
		tg::mutation::Data::Set { value } => {
			// We expect this to be a map of string to mutation.
			if let tg::value::Data::Map(mutations) = *value.clone() {
				apply_env(&mutations, artifacts_directories);
			} else {
				#[cfg(feature = "tracing")]
				tracing::error!(?value, "Unexpected value found for env, expected a map.");
				std::process::exit(1);
			}
		},
		_ => {
			#[cfg(feature = "tracing")]
			tracing::error!(
				?env,
				"Unexpected mutation found for env, expected Set or Unset."
			);
			std::process::exit(1);
		},
	}
}

fn apply_env(
	env: &BTreeMap<String, tg::value::Data>,
	artifacts_directories: &[impl AsRef<std::path::Path>],
) {
	for (key, value) in env {
		#[cfg(feature = "tracing")]
		tracing::debug!(?key, ?value, "Setting env.");
		apply_value_to_key(key, value, artifacts_directories);
	}
}

fn apply_value_to_key(
	key: &str,
	value: &tg::value::Data,
	artifacts_directories: &[impl AsRef<std::path::Path>],
) {
	if let tg::value::Data::Array(mutations) = value {
		for mutation in mutations {
			if let tg::value::Data::Mutation(mutation) = mutation {
				apply_mutation_to_key(key, mutation, artifacts_directories);
			}
		}
	} else if let tg::value::Data::Mutation(mutation) = value {
		apply_mutation_to_key(key, mutation, artifacts_directories);
	} else {
		std::env::set_var(key, render_value(value, artifacts_directories));
	}
}

fn apply_mutation_to_key(
	key: &str,
	mutation: &tg::mutation::Data,
	artifacts_directories: &[impl AsRef<std::path::Path>],
) {
	#[cfg(feature = "tracing")]
	tracing::debug!(?key, ?mutation, "Applying mutation.");
	match mutation {
		tg::mutation::Data::Unset => {
			std::env::remove_var(key);
		},
		tg::mutation::Data::Set { value } => {
			apply_value_to_key(key, value, artifacts_directories);
		},
		tg::mutation::Data::SetIfUnset { value } => {
			if std::env::var(key).is_err() {
				apply_value_to_key(key, value, artifacts_directories);
			}
		},
		tg::mutation::Data::Prepend { values } => {
			let values = values
				.iter()
				.map(|arg| render_value(arg, artifacts_directories))
				.collect::<Vec<_>>();
			let existing_values = std::env::var(key).ok().filter(|value| !value.is_empty());
			if let Some(existing_values) = existing_values {
				let s = values.join(":");
				std::env::set_var(key, format!("{s}:{existing_values}"));
			} else {
				std::env::set_var(key, values.join(":"));
			}
		},
		tg::mutation::Data::Append { values } => {
			let values = values
				.iter()
				.map(|arg| render_value(arg, artifacts_directories))
				.collect::<Vec<_>>();
			let existing_values = std::env::var(key).ok().filter(|value| !value.is_empty());
			if let Some(existing_values) = existing_values {
				let s = values.join(":");
				std::env::set_var(key, format!("{existing_values}:{s}"));
			} else {
				std::env::set_var(key, values.join(":"));
			}
		},
		tg::mutation::Data::Prefix {
			template,
			separator,
		} => {
			let value = render_template(template, artifacts_directories);
			let existing_value = std::env::var(key).ok().filter(|value| !value.is_empty());
			if let Some(existing_value) = existing_value {
				let s = separator.clone().unwrap_or(String::new());
				std::env::set_var(key, format!("{value}{s}{existing_value}"));
			} else {
				std::env::set_var(key, value);
			}
		},
		tg::mutation::Data::Suffix {
			template,
			separator,
		} => {
			let value = render_template(template, artifacts_directories);
			let existing_value = std::env::var(key).ok().filter(|value| !value.is_empty());
			if let Some(existing_value) = existing_value {
				let s = separator.clone().unwrap_or(String::new());
				std::env::set_var(key, format!("{existing_value}{s}{value}"));
			} else {
				std::env::set_var(key, value);
			}
		},
	}
}

#[must_use]
fn render_template(
	template: &tg::template::Data,
	artifacts_directories: &[impl AsRef<std::path::Path>],
) -> String {
	template
		.components
		.iter()
		.map(|component| match component {
			tg::template::component::Data::String(string) => string.clone(),
			tg::template::component::Data::Artifact(artifact_id) => artifacts_directories
				.iter()
				.find_map(|path| {
					let path = path.as_ref();
					let path = path.join(artifact_id.to_string());
					path.symlink_metadata().ok().map(|_| path)
				})
				.unwrap_or_else(|| {
					panic!(r#"Could not find the artifact with hash "{artifact_id}"."#)
				})
				.to_str()
				.expect("Invalid path.")
				.to_owned(),
		})
		.collect::<String>()
}

fn render_symlink(
	symlink: &tg::symlink::Data,
	artifacts_directories: &[impl AsRef<std::path::Path>],
) -> String {
	let template = template_from_symlink(symlink);
	render_template(&template, artifacts_directories)
}

fn render_value(
	value: &tg::value::Data,
	artifacts_directories: &[impl AsRef<std::path::Path>],
) -> String {
	match value {
		tg::value::Data::Null => String::new(),
		tg::value::Data::Bool(value) => {
			if *value {
				"true".to_owned()
			} else {
				"false".to_owned()
			}
		},
		tg::value::Data::Number(value) => value.to_string(),
		tg::value::Data::String(value) => value.clone(),
		tg::value::Data::Object(_) => {
			let symlink = symlink_from_artifact_value_data(value);
			render_symlink(&symlink, artifacts_directories)
		},
		tg::value::Data::Template(template) => render_template(template, artifacts_directories),
		_ => {
			#[cfg(feature = "tracing")]
			tracing::error!(?value, "Malformed manifest env value.");
			std::process::exit(1)
		},
	}
}

fn symlink_from_artifact_value_data(value: &tg::value::Data) -> tg::symlink::Data {
	if let tg::value::Data::Object(id) = value {
		match id {
			tg::object::Id::Directory(id) => {
				return tg::symlink::Data::Normal {
					artifact: Some(id.clone().into()),
					path: None,
				}
			},
			tg::object::Id::File(id) => {
				return tg::symlink::Data::Normal {
					artifact: Some(id.clone().into()),
					path: None,
				}
			},
			tg::object::Id::Symlink(id) => {
				return tg::symlink::Data::Normal {
					artifact: Some(id.clone().into()),
					path: None,
				}
			},
			_ => (),
		}
	}
	#[cfg(feature = "tracing")]
	tracing::error!(?value, "Malformed manifest. Expected an artifact value.");
	std::process::exit(1);
}

fn template_from_symlink(symlink: &tg::symlink::Data) -> tg::template::Data {
	let mut components = Vec::with_capacity(3);
	if let tg::symlink::Data::Normal { artifact, path } = symlink {
		if let Some(artifact) = artifact {
			components.push(tg::template::component::Data::Artifact(artifact.clone()));
		}
		if let Some(path) = path {
			components.push(tg::template::component::Data::String("/".to_owned()));
			components.push(tg::template::component::Data::String(path.to_string()));
		}
	}
	tg::template::Data { components }
}
