use {
	common::{Manifest, manifest},
	proxy::options,
	std::{
		ffi::{OsStr, OsString},
		path::{Path, PathBuf},
	},
	tangram_client::prelude::*,
};

#[cfg(test)]
mod tests;

#[derive(Debug)]
struct Options {
	/// The original arguments excluding owned controls.
	command_args: Vec<OsString>,
	/// The index of the input file in the filtered argument vector, if the arguments name exactly one.
	input: Option<usize>,
	/// Whether to skip wrapper rewriting and dependency preservation.
	passthrough: bool,
	/// The actual `install_name_tool` executable.
	program: PathBuf,
	/// The library path required by `install_name_tool` at runtime.
	runtime_library_path: Option<OsString>,
}

impl Options {
	fn parse() -> tg::Result<Self> {
		Self::parse_with_args(std::env::args_os().skip(1), |name| std::env::var_os(name))
	}

	fn parse_with_args(
		args: impl Iterator<Item = OsString>,
		mut lookup: impl FnMut(&str) -> Option<OsString>,
	) -> tg::Result<Self> {
		let program = lookup("TANGRAM_INSTALL_NAME_TOOL_COMMAND_PATH")
			.ok_or_else(|| tg::error!("TANGRAM_INSTALL_NAME_TOOL_COMMAND_PATH must be set"))?
			.into();
		let runtime_library_path = lookup("TANGRAM_INSTALL_NAME_TOOL_RUNTIME_LIBRARY_PATH")
			.filter(|value| !value.is_empty());
		let mut passthrough = lookup("TANGRAM_INSTALL_NAME_TOOL_PASSTHROUGH")
			.map(|value| options::boolean(&value, "TANGRAM_INSTALL_NAME_TOOL_PASSTHROUGH"))
			.transpose()?
			.unwrap_or(false);
		let mut command_args = Vec::new();
		for arg in args {
			if let Some((source, value)) = options::split(&arg)
				&& options::name(source) == Some("install-name-tool-passthrough")
			{
				passthrough = options::boolean(value.unwrap_or(OsStr::new("true")), source)?;
				continue;
			}
			command_args.push(arg);
		}
		let input = input(&command_args);
		let options = Self {
			command_args,
			input,
			passthrough,
			program,
			runtime_library_path,
		};
		Ok(options)
	}

	/// Get the arguments with the input file replaced by another path.
	fn input_args(&self, input: usize, path: &Path) -> Vec<OsString> {
		let mut args = self.command_args.clone();
		path.as_os_str().clone_into(&mut args[input]);
		args
	}
}

fn main() {
	// Set up tracing.
	#[cfg(feature = "tracing")]
	common::tracing::setup("TANGRAM_INSTALL_NAME_TOOL_TRACING");

	if let Err(error) = main_inner() {
		common::error::print_error(error);
		std::process::exit(1);
	}
}

fn main_inner() -> tg::Result<()> {
	let options = Options::parse()?;
	#[cfg(feature = "tracing")]
	tracing::info!(?options, "parsed options");

	// Pass the arguments through unchanged when there is no single regular input file to protect.
	let input = options
		.input
		.filter(|_| !options.passthrough)
		.filter(|index| {
			std::fs::metadata(&options.command_args[*index])
				.is_ok_and(|metadata| metadata.is_file())
		});
	let Some(input) = input else {
		#[cfg(feature = "tracing")]
		tracing::info!("passing through, running install_name_tool with unmodified arguments");
		run(&options, &options.command_args)?;
		return Ok(());
	};

	tg::init()?;
	tokio::runtime::Builder::new_current_thread()
		.enable_all()
		.build()
		.unwrap()
		.block_on(run_proxy(&options, input))?;

	Ok(())
}

async fn run_proxy(options: &Options, input: usize) -> tg::Result<()> {
	let path = Path::new(&options.command_args[input]);

	// Handle a wrapper, whose stub the native tool cannot edit.
	let manifest = Manifest::read_from_path(path).map_err(|error| {
		tg::error!(
			source = error,
			path = %path.display(),
			"failed to read the manifest"
		)
	})?;
	if let Some(manifest) = manifest {
		match &manifest.executable {
			manifest::Executable::Address(_) => {
				return Err(tg::error!(
					path = %path.display(),
					"cannot edit the install names of an embedded wrapper"
				));
			},
			manifest::Executable::Content(_) => {
				#[cfg(feature = "tracing")]
				tracing::warn!(
					?path,
					"found a content executable, running install_name_tool on the wrapper itself"
				);
				run(options, &options.command_args)?;
			},
			manifest::Executable::Path(_) => {
				#[cfg(feature = "tracing")]
				tracing::info!(?path, "editing the wrapped executable");
				common::rewrite::wrapper(path, manifest, |executable| {
					run(options, &options.input_args(input, executable))
				})
				.await?;
			},
		}
		return Ok(());
	}

	// Edit any other file in place and keep its dependencies.
	common::rewrite::file(path, || run(options, &options.command_args)).await?;

	Ok(())
}

/// Find the index of the single input file, skipping option values. Return `None` if the arguments do not name exactly one input or contain an option this proxy does not understand.
fn input(args: &[OsString]) -> Option<usize> {
	let mut input = None;
	let mut index = 0;
	while index < args.len() {
		let arg = args[index].as_encoded_bytes();
		if arg.starts_with(b"-") {
			index += 1 + arity(arg)?;
			if index > args.len() {
				return None;
			}
			continue;
		}
		if input.replace(index).is_some() {
			return None;
		}
		index += 1;
	}
	input
}

/// Get the number of values that an `install_name_tool` option takes.
fn arity(option: &[u8]) -> Option<usize> {
	match option {
		b"-add_rpath" | b"-delete_rpath" | b"-id" | b"-prepend_rpath" => Some(1),
		b"-change" | b"-rpath" => Some(2),
		b"-delete_all_rpaths" => Some(0),
		_ => None,
	}
}

/// Execute `install_name_tool` with the complete filtered argument vector.
fn run(options: &Options, args: &[OsString]) -> tg::Result<()> {
	let mut command = std::process::Command::new(&options.program);
	command.args(args);
	if let Some(runtime_library_path) = &options.runtime_library_path {
		command.env("DYLD_FALLBACK_LIBRARY_PATH", runtime_library_path);
	}
	let status = command
		.status()
		.map_err(|error| tg::error!(source = error, "could not run install_name_tool"))?;
	if !status.success() {
		return Err(tg::error!(
			"install_name_tool failed with status: {}",
			status
		));
	}
	Ok(())
}
