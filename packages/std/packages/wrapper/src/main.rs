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

	// Get arg0 from the invocation.
	let arg0 = &filtered_args[0];

	// Render the interpreter.
	let interpreter = handle_interpreter(manifest.interpreter.as_ref(), arg0.as_os_str())?;
	let interpreter_path = interpreter.as_ref().map(|(path, _)| path).cloned();
	#[cfg(feature = "tracing")]
	tracing::debug!(?interpreter_path);

	// Render the executable.
	let executable_path = match &manifest.executable {
		manifest::Executable::Path(file) => tangram_std::render_template_data(file)?.into(),
		manifest::Executable::Content(template) => {
			content_executable(&tangram_std::render_template_data(template)?)?
		},
	};

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
			mutate_env(env)?;
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
		unsafe {
			std::env::set_var("TANGRAM_INJECTION_IDENTITY_PATH", identity_path);
		}
	}

	// Set interpreter environment variables if necessary.
	if let Some(manifest::Interpreter::DyLd(interpreter)) = &manifest.interpreter {
		set_dyld_environment(interpreter)?;
	}

	// Forward arg 0.
	command.arg0(arg0);

	// Add the args.
	if !suppress_args {
		if let Some(args) = manifest.args {
			let command_args = args
				.iter()
				.map(tangram_std::render_template_data)
				.collect::<std::io::Result<Vec<_>>>()?;
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

	#[cfg(feature = "tracing")]
	tracing::trace!(?command);
	Err(command.exec())
}

/// Unset all currently set env vars.
fn clear_env() {
	std::env::vars().for_each(|(key, _)| unsafe { std::env::remove_var(key) });
}

/// Create a temporary file with the given contents and return the path to the file.
fn content_executable(contents: &str) -> std::io::Result<PathBuf> {
	#[cfg(feature = "tracing")]
	tracing::trace!("producing content executable.");
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
	let path = PathBuf::from(format!("/dev/fd/{fd}"));
	Ok(path)
}

#[allow(clippy::too_many_lines)]
fn handle_interpreter(
	interpreter: Option<&manifest::Interpreter>,
	arg0: &OsStr,
) -> Result<Option<(PathBuf, Vec<String>)>, std::io::Error> {
	let result = match interpreter {
		// Handle a normal interpreter.
		Some(manifest::Interpreter::Normal(interpreter)) => {
			let interpreter_path = tangram_std::render_template_data(&interpreter.path)?;
			let interpreter_path = PathBuf::from(interpreter_path).canonicalize()?;
			let interpreter_args = interpreter
				.args
				.iter()
				.map(tangram_std::render_template_data)
				.collect::<std::io::Result<_>>()?;
			Some((interpreter_path, interpreter_args))
		},

		// Handle an ld-linux interpreter.
		Some(manifest::Interpreter::LdLinux(interpreter)) => {
			// Render the interpreter path.
			let interpreter_path = tangram_std::render_template_data(&interpreter.path)?;

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
				.map(tangram_std::render_template_data)
				.collect::<std::io::Result<Vec<_>>>()?
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
					.map(tangram_std::render_template_data)
					.collect::<std::io::Result<Vec<_>>>()?
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
						.map(tangram_std::render_template_data)
						.collect::<std::io::Result<Vec<_>>>()?,
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
			let interpreter_path = tangram_std::render_template_data(&interpreter.path)?;

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
				.map(tangram_std::render_template_data)
				.collect::<std::io::Result<Vec<_>>>()?
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
					.map(tangram_std::render_template_data)
					.collect::<std::io::Result<Vec<_>>>()?
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
						.map(tangram_std::render_template_data)
						.collect::<std::io::Result<Vec<_>>>()?,
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

fn set_dyld_environment(interpreter: &manifest::DyLdInterpreter) -> std::io::Result<()> {
	// Set `TANGRAM_INJECTION_DYLD_LIBRARY_PATH`.
	if let Some(library_paths) = &interpreter.library_paths {
		let mut user_library_path = None;
		if let Ok(dyld_library_path) = std::env::var("DYLD_LIBRARY_PATH") {
			unsafe { std::env::set_var("TANGRAM_INJECTION_DYLD_LIBRARY_PATH", &dyld_library_path) };
			user_library_path = Some(dyld_library_path);
		} else {
			unsafe { std::env::remove_var("TANGRAM_INJECTION_DYLD_LIBRARY_PATH") };
		}
		let manifest_library_path = library_paths
			.iter()
			.map(tangram_std::render_template_data)
			.collect::<std::io::Result<Vec<_>>>()?
			.join(":");
		let library_path = if let Some(dyld_library_path) = user_library_path {
			format!("{dyld_library_path}:{manifest_library_path}")
		} else {
			manifest_library_path
		};
		#[cfg(feature = "tracing")]
		tracing::trace!(?library_path);
		unsafe { std::env::set_var("DYLD_LIBRARY_PATH", library_path) };
	}

	// Set `TANGRAM_INJECTION_DYLD_INSERT_LIBRARIES`.
	if let Some(preloads) = &interpreter.preloads {
		if let Ok(dyld_insert_libraries) = std::env::var("DYLD_INSERT_LIBRARIES") {
			unsafe {
				std::env::set_var(
					"TANGRAM_INJECTION_DYLD_INSERT_LIBRARIES",
					dyld_insert_libraries,
				);
			};
		} else {
			unsafe { std::env::remove_var("TANGRAM_INJECTION_DYLD_INSERT_LIBRARIES") };
		}
		let insert_libraries = preloads
			.iter()
			.map(tangram_std::render_template_data)
			.collect::<std::io::Result<Vec<_>>>()?
			.join(":");
		unsafe { std::env::set_var("DYLD_INSERT_LIBRARIES", insert_libraries) };
	}
	Ok(())
}

fn mutate_env(env: &tg::mutation::Data) -> std::io::Result<()> {
	match env {
		tg::mutation::Data::Unset => {
			clear_env();
		},
		tg::mutation::Data::Set { value } => {
			// We expect this to be a map of string to mutation.
			if let tg::value::Data::Map(mutations) = *value.clone() {
				apply_env(&mutations)?;
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
	Ok(())
}

fn apply_env(env: &BTreeMap<String, tg::value::Data>) -> std::io::Result<()> {
	for (key, value) in env {
		#[cfg(feature = "tracing")]
		tracing::debug!(?key, ?value, "Setting env.");
		apply_value_to_key(key, value)?;
	}
	Ok(())
}

fn apply_value_to_key(key: &str, value: &tg::value::Data) -> std::io::Result<()> {
	if let tg::value::Data::Array(mutations) = value {
		for mutation in mutations {
			if let tg::value::Data::Mutation(mutation) = mutation {
				apply_mutation_to_key(key, mutation)?;
			}
		}
	} else if let tg::value::Data::Mutation(mutation) = value {
		apply_mutation_to_key(key, mutation)?;
	} else {
		unsafe { std::env::set_var(key, render_value_data(value)?) };
	}
	Ok(())
}

fn apply_mutation_to_key(key: &str, mutation: &tg::mutation::Data) -> std::io::Result<()> {
	#[cfg(feature = "tracing")]
	tracing::debug!(?key, ?mutation, "Applying mutation.");
	match mutation {
		tg::mutation::Data::Unset => {
			unsafe { std::env::remove_var(key) };
		},
		tg::mutation::Data::Set { value } => {
			apply_value_to_key(key, value)?;
		},
		tg::mutation::Data::SetIfUnset { value } => {
			if std::env::var(key).is_err() {
				apply_value_to_key(key, value)?;
			}
		},
		tg::mutation::Data::Prepend { values } => {
			let values = values
				.iter()
				.map(render_value_data)
				.collect::<Result<Vec<_>, _>>()?;
			let existing_values = std::env::var(key).ok().filter(|value| !value.is_empty());
			if let Some(existing_values) = existing_values {
				let s = values.join(":");
				unsafe { std::env::set_var(key, format!("{s}:{existing_values}")) };
			} else {
				unsafe { std::env::set_var(key, values.join(":")) };
			}
		},
		tg::mutation::Data::Append { values } => {
			let values = values
				.iter()
				.map(render_value_data)
				.collect::<Result<Vec<_>, _>>()?;
			let existing_values = std::env::var(key).ok().filter(|value| !value.is_empty());
			if let Some(existing_values) = existing_values {
				let s = values.join(":");
				unsafe { std::env::set_var(key, format!("{existing_values}:{s}")) };
			} else {
				unsafe { std::env::set_var(key, values.join(":")) };
			}
		},
		tg::mutation::Data::Prefix {
			template,
			separator,
		} => {
			let value = tangram_std::render_template_data(template)?;
			let existing_value = std::env::var(key).ok().filter(|value| !value.is_empty());
			if let Some(existing_value) = existing_value {
				let s = separator.clone().unwrap_or(String::new());
				unsafe { std::env::set_var(key, format!("{value}{s}{existing_value}")) };
			} else {
				unsafe { std::env::set_var(key, value) };
			}
		},
		tg::mutation::Data::Suffix {
			template,
			separator,
		} => {
			let value = tangram_std::render_template_data(template)?;
			let existing_value = std::env::var(key).ok().filter(|value| !value.is_empty());
			if let Some(existing_value) = existing_value {
				let s = separator.clone().unwrap_or(String::new());
				unsafe { std::env::set_var(key, format!("{existing_value}{s}{value}")) };
			} else {
				unsafe { std::env::set_var(key, value) };
			}
		},
		tg::mutation::Data::Merge { .. } => {
			return Err(std::io::Error::new(
				std::io::ErrorKind::InvalidInput,
				"merge mutations are not supported for environment variables",
			));
		},
	}
	Ok(())
}

fn render_symlink_data(symlink: &tg::symlink::Data) -> std::io::Result<String> {
	let template = template_from_symlink(symlink)?;
	tangram_std::render_template_data(&template)
}

fn render_value_data(value: &tg::value::Data) -> std::io::Result<String> {
	let result = match value {
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
			render_symlink_data(&symlink)?
		},
		tg::value::Data::Template(template) => tangram_std::render_template_data(template)?,
		_ => {
			#[cfg(feature = "tracing")]
			tracing::error!(?value, "Malformed manifest env value.");
			std::process::exit(1)
		},
	};
	Ok(result)
}

fn symlink_from_artifact_value_data(value: &tg::value::Data) -> tg::symlink::Data {
	if let tg::value::Data::Object(id) = value {
		match id {
			tg::object::Id::Directory(id) => {
				return tg::symlink::Data::Artifact {
					artifact: id.clone().into(),
					subpath: None,
				};
			},
			tg::object::Id::File(id) => {
				return tg::symlink::Data::Artifact {
					artifact: id.clone().into(),
					subpath: None,
				};
			},
			tg::object::Id::Symlink(id) => {
				return tg::symlink::Data::Artifact {
					artifact: id.clone().into(),
					subpath: None,
				};
			},
			_ => (),
		}
	}
	#[cfg(feature = "tracing")]
	tracing::error!(?value, "Malformed manifest. Expected an artifact value.");
	std::process::exit(1);
}

fn template_from_symlink(symlink: &tg::symlink::Data) -> std::io::Result<tg::template::Data> {
	let mut components = Vec::with_capacity(3);
	match symlink {
		tg::symlink::Data::Target { target } => components.push(
			tg::template::component::Data::String(target.display().to_string()),
		),
		tg::symlink::Data::Artifact { artifact, subpath } => {
			components.push(tg::template::component::Data::Artifact(artifact.clone()));
			if let Some(subpath) = subpath {
				components.push(tg::template::component::Data::String("/".to_owned()));
				components.push(tg::template::component::Data::String(
					subpath.display().to_string(),
				));
			}
		},
		tg::symlink::Data::Graph { graph: _, node: _ } => {
			return Err(std::io::Error::new(
				std::io::ErrorKind::InvalidInput,
				"cannot produce a template from a symlink pointing into a graph",
			));
		},
	}
	let result = tg::template::Data { components };
	Ok(result)
}
