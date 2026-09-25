use {
	common::{Manifest, manifest},
	proxy::options,
	std::{
		ffi::{OsStr, OsString},
		path::{Path, PathBuf},
	},
	tangram_client::prelude::*,
};

fn main() {
	// Setup tracing.
	#[cfg(feature = "tracing")]
	common::tracing::setup("TANGRAM_STRIP_TRACING");

	if let Err(e) = main_inner() {
		common::error::print_error(e);
		std::process::exit(1);
	}
}

fn main_inner() -> tg::Result<()> {
	let options = Options::parse()?;
	#[cfg(feature = "tracing")]
	tracing::info!(?options, "parsed options");

	tg::init()?;

	// Set the runtime library path.
	let original_runtime_library_path =
		if let Some(runtime_library_path) = &options.strip_runtime_library_path {
			set_runtime_library_path(runtime_library_path)
		} else {
			None
		};

	// Determine if we should skip the proxy and pass through the arguments to strip unchanged.
	if options.passthrough || options.strip_targets.is_empty() {
		#[cfg(feature = "tracing")]
		tracing::info!("passing through, running strip with unmodified arguments");
		run_strip(&options.strip_program, &options.command_args)?;
		return Ok(());
	}

	// Process each occurrence in order so repeated paths see the updated wrapper.
	let mut wrappers = Vec::new();
	tokio::runtime::Builder::new_current_thread()
		.enable_all()
		.build()
		.unwrap()
		.block_on(async {
			for index in &options.strip_targets {
				let path = Path::new(&options.command_args[*index]);
				if let Some(manifest) = read_manifest(path)? {
					run_proxy(&options, *index, path, manifest).await?;
					wrappers.push(*index);
				}
			}
			Ok::<(), tg::Error>(())
		})?;

	// Retain non-wrapper targets in their original positions, including duplicates.
	if wrappers.len() != options.strip_targets.len() {
		let args = options
			.command_args
			.iter()
			.enumerate()
			.filter(|(index, _)| wrappers.binary_search(index).is_err())
			.map(|(_, arg)| arg.clone())
			.collect::<Vec<_>>();
		run_strip(&options.strip_program, &args)?;
	}

	// Reset the runtime library path.
	if let Some(original_runtime_library_path) = original_runtime_library_path {
		#[cfg(feature = "tracing")]
		tracing::info!(
			?original_runtime_library_path,
			"resetting runtime library path"
		);
		set_runtime_library_path(&original_runtime_library_path);
	}

	Ok(())
}

async fn run_proxy(
	options: &Options,
	target_index: usize,
	target_path: &Path,
	manifest: Manifest,
) -> tg::Result<()> {
	// Handle the executable based on its type.
	match &manifest.executable {
		manifest::Executable::Path(_) => {
			common::rewrite::wrapper(target_path, manifest, |executable| {
				// Call strip with the correct arguments on the executable.
				let args = options.wrapper_args(target_index, executable);
				run_strip(&options.strip_program, &args)?;
				#[cfg(feature = "tracing")]
				tracing::info!(?executable, "strip succeeded");
				Ok(())
			})
			.await?;
		},
		manifest::Executable::Address(_address) => {
			#[cfg(feature = "tracing")]
			tracing::info!(
				?target_path,
				"found address executable (embedded wrapper), skipping strip to preserve manifest"
			);
		},
		manifest::Executable::Content(_) => {
			#[cfg(feature = "tracing")]
			tracing::warn!(
				"found a content executable. passing through, but this is probably an error and likely to fail"
			);

			// If the executable is content, pass through the arguments to strip unchanged.
			let args = options.wrapper_args(target_index, target_path);
			run_strip(&options.strip_program, &args)?;
		},
	}

	Ok(())
}

#[derive(Debug)]
struct Options {
	/// The original arguments excluding owned controls.
	command_args: Vec<OsString>,
	/// Whether to skip wrapper rewriting.
	passthrough: bool,
	/// The actual strip executable.
	strip_program: PathBuf,
	/// The library path required by strip at runtime.
	strip_runtime_library_path: Option<String>,
	/// Target occurrence indices in the filtered argument vector.
	strip_targets: Vec<usize>,
}

impl Options {
	fn parse() -> tg::Result<Self> {
		Self::parse_with_args(std::env::args_os().skip(1), |name| std::env::var_os(name))
	}

	fn parse_with_args(
		args: impl Iterator<Item = OsString>,
		mut lookup: impl FnMut(&str) -> Option<OsString>,
	) -> tg::Result<Self> {
		let strip_program = lookup("TANGRAM_STRIP_COMMAND_PATH")
			.ok_or_else(|| tg::error!("TANGRAM_STRIP_COMMAND_PATH must be set"))?
			.into();
		let strip_runtime_library_path = lookup("TANGRAM_STRIP_RUNTIME_LIBRARY_PATH")
			.and_then(|value| value.into_string().ok())
			.filter(|value| !value.is_empty());
		let mut passthrough = lookup("TANGRAM_STRIP_PASSTHROUGH")
			.map(|value| options::boolean(&value, "TANGRAM_STRIP_PASSTHROUGH"))
			.transpose()?
			.unwrap_or(false);
		let mut ended = false;
		let mut command_args = Vec::new();
		let mut strip_targets = Vec::new();
		for arg in args {
			if !ended
				&& let Some((source, value)) = options::split(&arg)
				&& options::name(source) == Some("strip-passthrough")
			{
				passthrough = options::boolean(value.unwrap_or(OsStr::new("true")), source)?;
				continue;
			}
			if ended || !arg.as_encoded_bytes().starts_with(b"-") {
				strip_targets.push(command_args.len());
			}
			ended |= arg == "--";
			command_args.push(arg);
		}
		let options = Self {
			command_args,
			passthrough,
			strip_program,
			strip_runtime_library_path,
			strip_targets,
		};
		Ok(options)
	}

	fn wrapper_args(&self, target_index: usize, executable: &Path) -> Vec<OsString> {
		self.command_args
			.iter()
			.enumerate()
			.filter_map(|(index, arg)| {
				if index == target_index {
					Some(executable.as_os_str().to_owned())
				} else if self.strip_targets.binary_search(&index).is_ok() {
					None
				} else {
					Some(arg.clone())
				}
			})
			.collect()
	}
}

fn read_manifest(path: &Path) -> tg::Result<Option<Manifest>> {
	Manifest::read_from_path(path).map_err(|error| {
		tg::error!(
			source = error,
			"could not read the manifest from {}",
			path.display()
		)
	})
}

/// Execute strip with the complete filtered argument vector.
fn run_strip(strip_program: &Path, args: &[OsString]) -> tg::Result<()> {
	let status = std::process::Command::new(strip_program)
		.args(args)
		.status()
		.map_err(|error| tg::error!(source = error, "could not run strip"))?;
	if !status.success() {
		return Err(tg::error!("strip failed with status: {}", status));
	}
	Ok(())
}

/// Set the correct environment variable for the runtime library path. Returns the current value if set.
fn set_runtime_library_path(path: &str) -> Option<String> {
	#[cfg(feature = "tracing")]
	tracing::info!(?path, "setting runtime library path");

	if path.is_empty() {
		#[cfg(feature = "tracing")]
		tracing::warn!("runtime library path is empty, not setting");
		return None;
	}

	let var_name = if cfg!(target_os = "macos") {
		"DYLD_FALLBACK_LIBRARY_PATH"
	} else if cfg!(target_os = "linux") {
		"LD_LIBRARY_PATH"
	} else {
		unreachable!("unsupported target OS")
	};

	// Grab the current value of the variable.
	let current_value = std::env::var(var_name).ok();

	// Set the new value.
	unsafe { std::env::set_var(var_name, path) };

	current_value
}

#[cfg(test)]
mod tests;
