use itertools::Itertools;
use std::{collections::BTreeMap, os::unix::process::CommandExt, path::PathBuf};
use tangram_client as tg;
use tangram_wrapper::manifest::{
	self, Env, Executable, Identity, Interpreter, Manifest, MaybeMutation,
};
use tracing_subscriber::{prelude::__tracing_subscriber_SubscriberExt, util::SubscriberInitExt};

#[allow(clippy::too_many_lines)]
fn main() -> Result<(), Box<dyn std::error::Error>> {
	// Setup tracing.
	setup_tracing();

	// Get the wrapper path.
	let wrapper_path = std::env::current_exe()?.canonicalize()?;
	tracing::trace!(?wrapper_path);

	// Read the manifest.
	let manifest = Manifest::read(&wrapper_path)?.expect("Failed to read the manifest.");

	// If the `--tangram-print-manifest` arg is passed, then print the manifest and exit.
	if std::env::args().any(|arg| arg == "--tangram-print-manifest") {
		println!("{}", serde_json::to_string_pretty(&manifest).unwrap());
		return Ok(());
	}

	// Get the artifacts directories.
	let mut artifacts_directories = vec![];
	for path in wrapper_path.ancestors().skip(1) {
		let directory = path.join(".tangram/artifacts");
		if directory.exists() {
			artifacts_directories.push(directory);
		}
	}
	tracing::trace!(?artifacts_directories);

	// Shadow render functions with closures that capture the artifacts directories.
	let render_template =
		|template: &tg::template::Data| render_template(template, &artifacts_directories);

	// Get arg0 from the invocation.
	let arg0 = std::env::args_os().next().unwrap();

	// Render the interpreter.
	let interpreter = match &manifest.interpreter {
		// Handle a normal interpreter.
		Some(Interpreter::Normal(interpreter)) => {
			let interpreter_path = PathBuf::from(render_template(&interpreter.path));
			let interpreter_args = interpreter
				.args
				.iter()
				.map(|_| render_template(&interpreter.path))
				.collect();
			Some((interpreter_path, interpreter_args))
		},

		// Handle an ld-linux interpreter.
		Some(Interpreter::LdLinux(interpreter)) => {
			// Render the interpreter path.
			let interpreter_path = render_template(&interpreter.path);

			// Canonicalize the interpreter path.
			let interpreter_path = PathBuf::from(interpreter_path)
				.canonicalize()
				.expect("Failed to canonicalize the interpreter path.");

			// Initialize the interpreter arguments.
			let mut interpreter_args = vec![];

			// Inhibit reading from /etc/ld.so.cache.
			interpreter_args.push("--inhibit-cache".to_owned());

			// Create a library path for the interpreter itself.
			let interpreter_library_path = tg::template::Data {
				components: vec![tg::template::component::Data::String(
					interpreter_path
						.parent()
						.expect("Failed to get the interpreter's parent directory.")
						.to_str()
						.unwrap()
						.to_owned(),
				)],
			};

			// Render the interpreter library path and the library paths.
			let library_path = std::iter::once(&interpreter_library_path)
				.chain(interpreter.library_paths.iter().flatten())
				.map(render_template)
				.join(":");
			tracing::trace!(?library_path);
			interpreter_args.push("--library-path".to_owned());
			interpreter_args.push(library_path);

			// Render the preloads.
			if let Some(preloads) = &interpreter.preloads {
				let preload = preloads.iter().map(render_template).join(":");
				tracing::trace!(?preload);
				interpreter_args.push("--preload".to_owned());
				interpreter_args.push(preload);
			}

			// Add the additional interpreter args.
			if let Some(additional_args) = &interpreter.args {
				interpreter_args.extend(additional_args.iter().map(render_template));
			}

			// Forward argv0.
			interpreter_args.push("--argv0".to_owned());
			interpreter_args.push(arg0.to_str().unwrap().to_owned());

			Some((interpreter_path, interpreter_args))
		},

		// Handle an ld-musl interpreter.
		Some(Interpreter::LdMusl(interpreter)) => {
			// Render the interpreter path.
			let interpreter_path = render_template(&interpreter.path);

			// Canonicalize the interpreter path.
			let interpreter_path = PathBuf::from(interpreter_path)
				.canonicalize()
				.expect("Failed to canonicalize the interpreter path.");

			// Initialize the interpreter arguments.
			let mut interpreter_args = vec![];

			// Create a library path for the interpreter itself.
			let interpreter_library_path = tg::template::Data {
				components: vec![tg::template::component::Data::String(
					interpreter_path
						.parent()
						.expect("Failed to get the interpreter's parent directory.")
						.to_str()
						.unwrap()
						.to_owned(),
				)],
			};

			// Render the interpreter library path and the library paths.
			let library_path = std::iter::once(&interpreter_library_path)
				.chain(interpreter.library_paths.iter().flatten())
				.map(render_template)
				.join(":");
			tracing::trace!(?library_path);
			interpreter_args.push("--library-path".to_owned());
			interpreter_args.push(library_path);

			// Render the preloads.
			if let Some(preloads) = &interpreter.preloads {
				let preload = preloads.iter().map(render_template).join(":");
				tracing::trace!(?preload);
				interpreter_args.push("--preload".to_owned());
				interpreter_args.push(preload);
			}

			// Add the additional interpreter args.
			if let Some(additional_args) = &interpreter.args {
				interpreter_args.extend(additional_args.iter().map(render_template));
			}

			// Forward argv0.
			interpreter_args.push("--argv0".to_owned());
			interpreter_args.push(arg0.to_str().unwrap().to_owned());

			Some((interpreter_path, interpreter_args))
		},

		// Handle a dyld interpreter or no interpreter.
		Some(Interpreter::DyLd(_)) | None => None,
	};
	let interpreter_path = interpreter.as_ref().map(|(path, _)| path).cloned();

	// Render the executable.
	let executable_path = match &manifest.executable {
		Executable::Path(file) => PathBuf::from(render_template(file)),

		Executable::Content(template) => unsafe {
			// Render the template.
			let contents = render_template(template);

			// Create a temporary file.
			let temp_path = std::ffi::CString::new("/tmp/XXXXXX").unwrap();
			let fd = libc::mkstemp(temp_path.as_ptr().cast_mut());
			if fd == -1 {
				tracing::error!(?temp_path, "Failed to create temporary file.");
				return Err(std::io::Error::last_os_error().into());
			}

			// Unlink the temporary file.
			let ret = libc::unlink(temp_path.as_ptr());
			if ret == -1 {
				tracing::error!(?temp_path, "Failed to unlink temporary file.");
				return Err(std::io::Error::last_os_error().into());
			}

			// Write the contents to the temporary file.
			let mut written = 0;
			while written < contents.len() {
				let slice = &contents[written..];
				let ret = libc::write(fd, slice.as_ptr().cast(), slice.len());
				if ret == -1 {
					tracing::error!(?temp_path, "Failed to write to temporary file.");
					return Err(std::io::Error::last_os_error().into());
				}
				#[allow(clippy::cast_sign_loss)]
				let ret: usize = if ret >= 0 { ret as usize } else { 0 };
				written += ret;
			}

			// Seek to the beginning of the temporary file.
			let ret = libc::lseek(fd, 0, libc::SEEK_SET);
			if ret == -1 {
				tracing::error!(
					?temp_path,
					"Failed to seek to the beginning of the temporary file."
				);
				return Err(std::io::Error::last_os_error().into());
			}

			// Create a path to the temporary file.
			PathBuf::from(format!("/dev/fd/{fd}"))
		},
	};

	// Choose the identity path.
	let identity_path = match &manifest.identity {
		Identity::Wrapper => wrapper_path,
		Identity::Interpreter => interpreter_path.expect("If the manifest specifies the interpreter as its identity, then the manifest must contain an interpreter."),
		Identity::Executable => executable_path.clone(),
	};

	// Create the command.
	let mut command = if let Some((interpreter_path, interpreter_args)) = interpreter {
		tracing::trace!(?interpreter_path);
		tracing::trace!(?interpreter_args);
		tracing::trace!(?executable_path);
		let mut command = std::process::Command::new(interpreter_path);
		command.args(interpreter_args);
		command.arg(executable_path);
		command
	} else {
		tracing::trace!(?executable_path);
		std::process::Command::new(executable_path)
	};

	// Set the env.
	if let Some(env) = &manifest.env {
		mutate_env(env, &artifacts_directories);
	}

	// Set `TANGRAM_INJECTION_IDENTITY_PATH` if necessary.
	if let Some(Interpreter::LdLinux(_) | Interpreter::LdMusl(_) | Interpreter::DyLd(_)) =
		&manifest.interpreter
	{
		// Set `TANGRAM_INJECTION_IDENTITY_PATH`.
		std::env::set_var("TANGRAM_INJECTION_IDENTITY_PATH", identity_path);
	}

	// Set interpreter environment variables if necessary.
	if let Some(Interpreter::DyLd(interpreter)) = &manifest.interpreter {
		// Set `TANGRAM_INJECTION_DYLD_LIBRARY_PATH`.
		if let Some(library_paths) = &interpreter.library_paths {
			if let Ok(dyld_library_path) = std::env::var("DYLD_LIBRARY_PATH") {
				std::env::set_var("TANGRAM_INJECTION_DYLD_LIBRARY_PATH", dyld_library_path);
			} else {
				std::env::remove_var("TANGRAM_INJECTION_DYLD_LIBRARY_PATH");
			}
			let library_path = library_paths.iter().map(render_template).join(":");
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
			let insert_libraries = preloads.iter().map(render_template).join(":");
			std::env::set_var("DYLD_INSERT_LIBRARIES", insert_libraries);
		}
	}

	// Forward arg 0.
	command.arg0(arg0);

	// Add the args.
	let command_args = manifest.args.iter().map(render_template).collect_vec();
	tracing::trace!(?command_args);
	command.args(command_args);

	// Add the wrapper args.
	let wrapper_args = std::env::args_os().skip(1).collect_vec();
	tracing::trace!(?wrapper_args);
	command.args(wrapper_args);

	// Exec the command.
	tracing::trace!(?command);
	Err(command.exec().into())
}

fn clear_env() {
	std::env::vars().for_each(|(key, _)| std::env::remove_var(key));
}

fn mutate_env(env: &Env, artifacts_directories: &[impl AsRef<std::path::Path>]) {
	match env {
		Env::Unset => {
			clear_env();
		},
		Env::Map(mutations) => {
			apply_env_mutations(mutations, artifacts_directories);
		},
	}
}

fn apply_env_mutations(
	env: &BTreeMap<String, Vec<MaybeMutation>>,
	artifacts_directories: &[impl AsRef<std::path::Path>],
) {
	for (name, mutations) in env {
		tracing::debug!(?name, ?mutations, "Setting env.");
		for maybe_mutation in mutations {
			match maybe_mutation {
				MaybeMutation::Mutation(mutation) => {
					apply_single_mutation(name, mutation, artifacts_directories);
				},
				MaybeMutation::Template(template) => {
					std::env::set_var(name, render_template(template, artifacts_directories));
				},
			};
		}
	}
}

fn apply_single_mutation(
	name: &str,
	mutation: &manifest::Mutation,
	artifacts_directories: &[impl AsRef<std::path::Path>],
) {
	tracing::debug!(?name, ?mutation, "Applying mutation.");
	match mutation {
		manifest::Mutation::Unset => {
			std::env::remove_var(name);
		},
		manifest::Mutation::Set(value) => {
			let value = render_template(value, artifacts_directories);
			std::env::set_var(name, value);
		},
		manifest::Mutation::SetIfUnset(value) => {
			let value = render_template(value, artifacts_directories);
			if std::env::var(name).is_err() {
				std::env::set_var(name, value);
			}
		},
		manifest::Mutation::ArrayPrepend(values) => {
			let values = values
				.iter()
				.map(|arg| render_template(arg, artifacts_directories))
				.collect_vec();
			let existing_values = std::env::var(name).ok().filter(|value| !value.is_empty());
			if let Some(existing_values) = existing_values {
				let s = values.join(":");
				std::env::set_var(name, format!("{s}:{existing_values}"));
			} else {
				std::env::set_var(name, values.join(":"));
			}
		},
		manifest::Mutation::ArrayAppend(values) => {
			let values = values
				.iter()
				.map(|arg| render_template(arg, artifacts_directories))
				.collect_vec();
			let existing_values = std::env::var(name).ok().filter(|value| !value.is_empty());
			if let Some(existing_values) = existing_values {
				let s = values.join(":");
				std::env::set_var(name, format!("{existing_values}:{s}"));
			} else {
				std::env::set_var(name, values.join(":"));
			}
		},
		manifest::Mutation::TemplatePrepend(template_mutation) => {
			let value = render_template(&template_mutation.template, artifacts_directories);
			let existing_value = std::env::var(name).ok().filter(|value| !value.is_empty());
			if let Some(existing_value) = existing_value {
				let s = template_mutation.separator.clone().unwrap_or(String::new());
				std::env::set_var(name, format!("{value}{s}{existing_value}"));
			} else {
				std::env::set_var(name, value);
			}
		},
		manifest::Mutation::TemplateAppend(template_mutation) => {
			let value = render_template(&template_mutation.template, artifacts_directories);
			let existing_value = std::env::var(name).ok().filter(|value| !value.is_empty());
			if let Some(existing_value) = existing_value {
				let s = template_mutation.separator.clone().unwrap_or(String::new());
				std::env::set_var(name, format!("{existing_value}{s}{value}"));
			} else {
				std::env::set_var(name, value);
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
		.join("")
}

fn setup_tracing() {
	// Create the env layer.
	let tracing_env_filter = std::env::var("TANGRAM_WRAPPER_TRACING").ok();
	let env_layer = tracing_env_filter
		.map(|env_filter| tracing_subscriber::filter::EnvFilter::try_new(env_filter).unwrap());

	// If tracing is enabled, create and initialize the subscriber.
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
