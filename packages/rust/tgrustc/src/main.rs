use itertools::Itertools;
use std::{collections::BTreeMap, os::unix::process::CommandExt, path::PathBuf, str::FromStr};
use tangram_client::prelude::*;
use tokio::io::AsyncWriteExt;

// Input arguments to the rustc proxy.
#[derive(Debug)]
struct Args {
	// The argument used for rustc.
	rustc: String,

	// Whether the caller expects to pipe stdin into this proxy.
	stdin: bool,

	// Any -L dependency=PATH arguments.
	dependencies: Vec<String>,

	// Any --extern NAME=PATH arguments.
	externs: Vec<(String, String)>,

	// The --out-dir PATH if it exists.
	rustc_output_directory: Option<String>,

	// The rest of the arguments passed to rustc.
	remaining: Vec<String>,

	// For cargo builds, this is found via CARGO_MANIFEST_DIRECTORY set by cargo. For plain rustc invocations, it is the parent of the source file.
	source_directory: String,

	// The value of OUT_DIR set by cargo.
	cargo_out_directory: Option<String>,
}

impl Args {
	// Parse the command line arguments passed to the proxy by cargo.
	fn parse() -> tg::Result<Self> {
		// Parse arguments.
		let rustc = std::env::args()
			.nth(1)
			.ok_or(tg::error!("missing argument for rustc"))?;
		let mut stdin = false;
		let mut dependencies = Vec::new();
		let mut externs = Vec::new();
		let mut rustc_output_directory = None;
		let mut remaining = Vec::new();
		let cargo_out_directory = std::env::var("OUT_DIR").ok();

		// TODO: sort the arguments into a canonical order to maximize cache hits.
		let mut arg_iter = std::env::args().skip(2).peekable();
		while let Some(arg) = arg_iter.next() {
			let value = if ARGS_WITH_VALUES.contains(&arg.as_str())
				&& arg_iter
					.peek()
					.is_some_and(|a| !a.starts_with('-'))
			{
				arg_iter.next()
			} else {
				None
			};
			match (arg.as_ref(), value) {
				("-L", Some(value)) if value.starts_with("dependency=") => {
					let dependency = value.strip_prefix("dependency=").unwrap().into();
					dependencies.push(dependency);
				},
				("--extern", Some(value)) => {
					let components = value.split('=').collect_vec();
					let (name, path) = if components.len() == 1 {
						(components[0], "")
					} else if components.len() == 2 {
						(components[0], components[1])
					} else {
						return Err(tg::error!("invalid --extern argument: {value}"));
					};
					externs.push((name.into(), path.into()));
				},
				("--out-dir", Some(value)) => {
					rustc_output_directory = Some(value);
				},
				(arg, None) if arg.starts_with("--out-dir=") => {
					if let Some(suffix) = arg.strip_prefix("--out-dir=") {
						rustc_output_directory = Some(suffix.into());
					}
				},
				("-", None) => {
					stdin = true;
					remaining.push("-".into());
				},
				(_, None) => {
					remaining.push(arg);
				},
				(_, Some(value)) => {
					remaining.push(arg);
					remaining.push(value);
				},
			}
		}

		// Read environment variables set by cargo. CARGO_MANIFEST_DIR isn't guaranteed to be set by cargo, but we don't need to care about that case.
		let cargo_manifest_directory = std::env::var("CARGO_MANIFEST_DIR").ok();

		// Determine the directory containing the source.
		let source_directory = if let Some(dir) = cargo_manifest_directory {
			// If cargo set CARGO_MANIFEST_DIR, it's that directory.
			dir
		} else {
			// Otherwise, it's the only argument left in remaining with a ".rs" extension.
			let mut source_directory = None;
			for arg in &remaining {
				if std::path::Path::new(arg)
					.extension()
					.is_some_and(|ext| ext.eq_ignore_ascii_case("rs"))
				{
					let path = std::path::Path::new(arg);
					let parent = path.parent();
					if let Some(parent) = parent
						&& let Some(parent_str) = parent.to_str()
					{
						source_directory = Some(parent_str.to_owned());
						break;
					}
				}
			}
			// If we still couldn't find it, fall back to ".".
			source_directory.unwrap_or(".".to_string())
		};

		Ok(Self {
			rustc,
			stdin,
			dependencies,
			externs,
			rustc_output_directory,
			remaining,
			source_directory,
			cargo_out_directory,
		})
	}
}

fn main() {
	// Setup tracing.
	#[cfg(feature = "tracing")]
	tangram_std::tracing::setup("TGRUSTC_TRACING");

	if let Err(e) = main_inner() {
		eprintln!("rustc proxy failed:");
		tangram_std::error::print_error(e);
		std::process::exit(1);
	}
}

fn main_inner() -> tg::Result<()> {
	let args = Args::parse()?;
	#[cfg(feature = "tracing")]
	tracing::info!(?args, "parsed arguments");

	// If cargo expects to pipe into stdin or contains only a single arg, we immediately invoke rustc without doing anything.
	if args.stdin || args.remaining.len() < 2 {
		#[cfg(feature = "tracing")]
		tracing::info!("invoking rustc without tangram");
		let error = std::process::Command::new(std::env::args().nth(1).unwrap())
			.args(std::env::args().skip(2))
			.exec();
		return Err(tg::error!("exec failed: {error}."));
	}

	tokio::runtime::Builder::new_multi_thread()
		.enable_all()
		.build()
		.unwrap()
		.block_on(run_proxy(args))?;

	Ok(())
}

/// Run the proxy.
#[allow(clippy::too_many_lines)]
async fn run_proxy(args: Args) -> tg::Result<()> {
	// Create a client.
	let tg = tg::Client::with_env()?;
	let tg = &tg;

	// Check in the source and output directories.
	let source_directory_path = args.source_directory;
	#[cfg(feature = "tracing")]
	tracing::info!(?source_directory_path, "checking in source directory");
	let source_directory = get_checked_in_path(tg, &source_directory_path).await?;
	let out_dir: tg::Value = if let Some(path) = &args.cargo_out_directory {
		let out_dir_path = std::path::PathBuf::from_str(path)
			.map_err(|source| tg::error!(!source, %path,  "unable to construct path"))?;
		#[cfg(feature = "tracing")]
		tracing::info!(?out_dir_path, "checking in output directory");
		get_checked_in_path(tg, &out_dir_path).await?
	} else {
		// Create an empty directory, store it, and wrap it in a template so it renders as a path.
		let empty_dir = tg::Directory::with_entries(BTreeMap::new());
		empty_dir.store(tg).await?;
		tangram_std::template_from_artifact(empty_dir.into()).into()
	};

	// Create the executable file.
	let contents = tg::Blob::with_reader(tg, DRIVER_SH).await?;
	let is_executable = true;
	let dependencies = BTreeMap::new();
	let object = tg::file::Object::Node(tg::file::object::Node {
		contents,
		dependencies,
		executable: is_executable,
	});
	let driver_file = tg::File::with_object(object);
	let executable: tg::command::Executable = driver_file.into();

	// Unrender the environment.
	let mut env = BTreeMap::new();
	for (name, value) in
		std::env::vars().filter(|(name, _)| !BLACKLISTED_ENV_VARS.contains(&name.as_str()))
	{
		// For CARGO_MAKEFLAGS, drop the jobserver arguments. We are spawning new builds and explicitly do not want to coordinate with cargo's jobserver.
		let value = if name == "CARGO_MAKEFLAGS" {
			value
				.split(' ')
				.filter(|arg| !arg.starts_with("--jobserver"))
				.join(" ")
		} else {
			value
		};

		let value = tangram_std::unrender(&value)?;
		env.insert(name, value.into());
	}

	// Create/Unrender the arguments passed to driver.sh.
	let rustc = tangram_std::unrender(&args.rustc)?;
	let name = "tgrustc".to_string().into();
	#[cfg(feature = "tracing")]
	tracing::info!(?source_directory, "source_directory value for inner build");
	let mut command_args: Vec<tg::Value> = vec![
		name,
		"--rustc".to_owned().into(),
		rustc.into(),
		"--source".to_owned().into(),
		source_directory,
		"--out-dir".to_owned().into(),
		out_dir,
		"--".to_owned().into(),
	];

	for arg in &args.remaining {
		let template = tangram_std::unrender(arg)?;
		command_args.push(template.into());
	}

	// Check in any -L dependency=PATH directories, and splice any matching --extern name=PATH args.
	let mut used_externs = fnv::FnvHashSet::default();
	for dependency in &args.dependencies {
		#[cfg(feature = "tracing")]
		tracing::info!(?dependency, "checking in dependency");
		let directory = tg::checkin(
			tg,
			tg::checkin::Arg {
				options: tg::checkin::Options {
					destructive: false,
					deterministic: true,
					ignore: false,
					local_dependencies: true,
					locked: true,
					lock: Some(tg::checkin::Lock::Attr),
					..tg::checkin::Options::default()
				},
				path: dependency.parse().unwrap(),
				updates: vec![],
			},
		)
		.await?;
		let template = tg::Template {
			components: vec!["dependency=".to_owned().into(), directory.clone().into()],
		};
		command_args.extend(["-L".to_owned().into(), template.into()]);
		let externs = args
			.externs
			.iter()
			.filter_map(|(name, path)| {
				let template = if path.is_empty() {
					tg::Template {
						components: vec![name.clone().into()],
					}
				} else {
					let subpath = path.strip_prefix(dependency)?;
					tg::Template {
						components: vec![
							format!("{name}=").into(),
							directory.clone().into(),
							subpath.to_owned().into(),
						],
					}
				};
				used_externs.insert(name);
				Some(["--extern".to_owned().into(), template.into()])
			})
			.flatten();
		command_args.extend(externs);
	}

	// Add any externs that were not already handled.
	let unhandled_externs = args
		.externs
		.iter()
		.filter(|(name, _)| !used_externs.contains(name));
	#[cfg(feature = "tracing")]
	tracing::info!(?unhandled_externs, "adding unhandled externs");
	command_args.extend(unhandled_externs.flat_map(|(name, path)| {
		let template = if path.is_empty() {
			tg::Template {
				components: vec![name.clone().into()],
			}
		} else {
			tg::Template {
				components: vec![format!("{name}=").into(), path.to_owned().into()],
			}
		};
		["--extern".to_owned().into(), template.into()]
	}));

	// Create the process.
	let host = host().to_string();
	#[cfg(feature = "tracing")]
	tracing::info!(?host, "creating inner process");

	// Log args for debugging before they are moved.
	#[cfg(feature = "tracing")]
	tracing::info!(?command_args, "full command args for inner process");

	// Build a command for the process.
	let mut command_builder = tg::Command::builder(host, executable);
	command_builder = command_builder.args(command_args);
	command_builder = command_builder.env(env);
	let command = command_builder.build();
	let command_id = command.store(tg).await?;
	let mut command_ref = tg::Referent::with_item(command_id);
	command_ref.options.name.replace("rustc".into());

	// Spawn the process.
	let mut spawn_arg = tg::process::spawn::Arg::with_command(command_ref);
	spawn_arg.network = false;

	#[cfg(feature = "tracing")]
	tracing::info!("spawning inner process");

	let process = tg::Process::spawn(tg, spawn_arg).await?;
	let process_id = process.id().clone();

	#[cfg(feature = "tracing")]
	tracing::info!(?process_id, "spawned inner process");

	// Wait for the process output.
	let output = match process.output(tg).await {
		Ok(output) => output,
		Err(e) => {
			// Now we have the process ID, so the user can run `tangram log <process_id>` to see the actual error.
			eprintln!("Inner process failed. View logs with: tangram log {process_id}");
			#[cfg(feature = "tracing")]
			tracing::error!(?e, ?process_id, "inner process error details");
			return Err(e);
		},
	};
	let output = output
		.try_unwrap_object()
		.map_err(|source| tg::error!(!source, "expected the build to produce an object"))?
		.try_unwrap_directory()
		.map_err(|source| tg::error!(!source, "expected the build to produce a directory"))?;

	#[cfg(feature = "tracing")]
	{
		let output_id = output.id();
		tracing::info!(?output_id, "got output");
	}

	// Get stdout/stderr from the build and forward it to our stdout/stderr.
	let stdout = output
		.get(tg, &"log/stdout")
		.await?
		.try_unwrap_file()
		.unwrap()
		.contents(tg)
		.await?
		.bytes(tg)
		.await?;
	tokio::io::stdout()
		.write_all(&stdout)
		.await
		.map_err(|error| tg::error!(source = error, "failed to write stderr"))?;
	let stderr = output
		.get(tg, &"log/stderr")
		.await?
		.try_unwrap_file()
		.unwrap()
		.contents(tg)
		.await?
		.bytes(tg)
		.await?;
	tokio::io::stderr()
		.write_all(&stderr)
		.await
		.map_err(|error| tg::error!(source = error, "failed to write stderr"))?;

	// Ensure the result is available with an internal checkout.
	// Dependencies must be checked out so that wrapped binaries (like build scripts)
	// can access their artifact references (interpreter, libraries, etc.) when run.
	let artifact = tg::Artifact::from(output.clone()).id();
	let path = tg::checkout(
		tg,
		tg::checkout::Arg {
			artifact,
			dependencies: true,
			force: true,
			path: None,
			lock: None,
		},
	)
	.await?;
	#[cfg(feature = "tracing")]
	tracing::info!(?path, "checked out result artifact");

	// Get the output directory.
	let build_directory = path.join("build");
	let build_directory = build_directory.as_path();
	#[cfg(feature = "tracing")]
	tracing::info!(?build_directory, "got build directory");

	// Copy output files from $TANGRAM_OUTPUT to the path specified.
	for from in build_directory.read_dir().map_err(|e| {
		tg::error!(
			source = e,
			"could not read output directory {}",
			build_directory.display()
		)
	})? {
		let filename = from.unwrap().file_name().into_string().unwrap();
		let from = build_directory.join(&filename);
		let to_parent = PathBuf::from(args.rustc_output_directory.as_ref().unwrap());
		// Create the parent directory if it doesn't exist.
		if !to_parent.exists() {
			tokio::fs::create_dir_all(&to_parent)
				.await
				.map_err(|error| {
					tg::error!(
						source = error,
						"failed to create output directory {}",
						to_parent.display()
					)
				})?;
		}
		let to = to_parent.join(filename);
		if from.exists() && from.is_file() {
			tokio::fs::copy(&from, &to).await.map_err(|error| {
				tg::error!(
					source = error,
					"failed to copy output directory from {} to {}",
					from.display(),
					to.display()
				)
			})?;
		}
	}
	Ok(())
}

/** Search up from the current directory to find the manifest directory. */
fn find_root_manifest_dir(cargo_manifest_dir: &impl AsRef<std::path::Path>) -> PathBuf {
	let start_dir = cargo_manifest_dir.as_ref().to_path_buf();
	// start at the parent.
	let current_dir = start_dir.parent();
	if current_dir.is_none() {
		return start_dir;
	}
	let mut current_dir = current_dir.unwrap().to_path_buf();

	loop {
		let manifest_path = current_dir.join("Cargo.toml");
		if manifest_path.exists() {
			#[cfg(feature = "tracing")]
			tracing::info!(?manifest_path, "found Cargo.toml");
			if let Ok(contents) = std::fs::read_to_string(&manifest_path) {
				if contents.contains("[workspace]") {
					// Found a workspace root
					#[cfg(feature = "tracing")]
					tracing::info!("found workspace root");
					return current_dir;
				} else if current_dir == start_dir {
					#[cfg(feature = "tracing")]
					tracing::info!("found Cargo.toml in the original package");
					// This is the original package's Cargo.toml and it's not a workspace
					return current_dir;
				}
				// If it's not the start_dir and doesn't contain [workspace],
				// continue searching upwards
			}
		}

		// Move up to the parent directory
		if !current_dir.pop() {
			// We've reached the root directory without finding a workspace manifest
			// Return the original package's Cargo.toml
			return start_dir;
		}
	}
}

// The driver script.
const DRIVER_SH: &[u8] = include_bytes!("driver.sh");

// List of rustc args that take a value.
const ARGS_WITH_VALUES: [&str; 32] = [
	"--allow",
	"--cap-lints",
	"--cfg",
	"--codegen",
	"--color",
	"--crate-name",
	"--crate-type",
	"--deny",
	"--diagnostic-width",
	"--edition",
	"--emit",
	"--error-format",
	"--explain",
	"--extern",
	"--forbid",
	"--force-warn",
	"--json",
	"--out-dir",
	"--print",
	"--print",
	"--remap-path-refix",
	"--sysroot",
	"--target",
	"--warn",
	"-A",
	"-C",
	"-D",
	"-F",
	"-l",
	"-L",
	"-o",
	"-W",
];

// Environment variables that must be filtered out before invoking the driver target.
const BLACKLISTED_ENV_VARS: [&str; 5] = [
	"TGRUSTC_TRACING",
	"TANGRAM_HOST",
	"TANGRAM_URL",
	"HOME",
	"TANGRAM_OUTPUT",
];

/// Given a string path, return a [`tg::Path`] pointing to a checked-in artifact. If the path is already checked in or is ".", do nothing.
async fn get_checked_in_path(
	tg: &impl tg::Handle,
	path: &impl AsRef<std::path::Path>,
) -> tg::Result<tg::Value> {
	// If the path is in the working directory, check it in. If the path points to a checked-in artifact, return it as artifact/subpath (symlink)
	let path = path.as_ref();
	let path_str = path.to_str().unwrap();

	if path_str == "." {
		return Ok(".".into());
	}

	// Unrender the string.
	let symlink_data = tangram_std::template_data_to_symlink_data(tangram_std::unrender(path_str)?.to_data())?;
	#[cfg(feature = "tracing")]
	tracing::info!(?symlink_data, "unrendered symlink data");

	// If the symlink data has an artifact, return a template that preserves the artifact reference.
	// This is necessary because inside a Tangram sandbox, raw filesystem paths to artifacts
	// are not accessible - the artifact must be passed as a reference in the process arguments.
	if let tg::symlink::Data::Node(tg::symlink::data::Node {
		artifact: Some(_),
		path: _,
	}) = symlink_data
	{
		let root_dir = find_root_manifest_dir(&path_str);
		let root_dir_str = root_dir.display().to_string();
		#[cfg(feature = "tracing")]
		tracing::info!(?root_dir_str, "found root directory, re-unrendering to preserve artifact reference");
		// Re-unrender the root directory path to get a template that includes the artifact reference.
		let template = tangram_std::unrender(&root_dir_str)?;
		return Ok(template.into());
	}

	#[cfg(feature = "tracing")]
	tracing::info!(?path, "no artifact found in symlink data, checking in");

	// Otherwise, check in the path and wrap in a template so it renders as a path.
	let artifact = tg::checkin(
		tg,
		tg::checkin::Arg {
			options: tg::checkin::Options {
				deterministic: true,
				ignore: false,
				lock: None,
				..Default::default()
			},
			path: path.to_path_buf(),
			updates: vec![],
		},
	)
	.await?;

	// Wrap in a template so it renders as a path, not just the artifact ID.
	Ok(tangram_std::template_from_artifact(artifact).into())
}

/// Get the host string for the current target.
#[must_use]
pub fn host() -> &'static str {
	#[cfg(all(target_arch = "aarch64", target_os = "macos"))]
	{
		"aarch64-darwin"
	}
	#[cfg(all(target_arch = "aarch64", target_os = "linux"))]
	{
		"aarch64-linux"
	}
	#[cfg(all(target_arch = "x86_64", target_os = "macos"))]
	{
		"x86_64-darwin"
	}
	#[cfg(all(target_arch = "x86_64", target_os = "linux"))]
	{
		"x86_64-linux"
	}
}

