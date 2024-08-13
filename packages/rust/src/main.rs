use itertools::Itertools;
use std::{collections::BTreeMap, os::unix::process::CommandExt, path::PathBuf};
use tangram_client as tg;
use tokio::io::AsyncWriteExt;
#[cfg(feature = "tracing")]
use tracing_subscriber::{prelude::__tracing_subscriber_SubscriberExt, util::SubscriberInitExt};

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
	rustc_args: Vec<String>,

	// The the value of CARGO_MANIFEST_DIRECTORY set by cargo.
	cargo_manifest_directory: String,

	// The value of OUT_DIR set by cargo.
	cargo_out_directory: Option<String>,

	// The location of the nearest .tangram directory.
	tangram_path: PathBuf,
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
		let mut rustc_args = Vec::new();

		// TODO: sort the arguments into a canonical order to maximize cache hits.
		let mut args = std::env::args().skip(2).peekable();
		while let Some(arg) = args.next() {
			let value = if ARGS_WITH_VALUES.contains(&arg.as_str())
				&& args
					.peek()
					.map(|arg| !arg.starts_with('-'))
					.unwrap_or(false)
			{
				args.next()
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
				("-", None) => {
					stdin = true;
					rustc_args.push("-".into());
				},
				(_, None) => {
					rustc_args.push(arg);
				},
				(_, Some(value)) => {
					rustc_args.push(arg);
					rustc_args.push(value);
				},
			}
		}

		// Read environment variables set by cargo. CARGO_MANIFEST_DIR isn't guaranteed to be set by cargo, but we don't need to care about that case.
		let cargo_manifest_directory = std::env::var("CARGO_MANIFEST_DIR").unwrap_or(".".into());
		let cargo_out_directory = std::env::var("OUT_DIR").ok();

		// Find the tangram path.
		let cwd = std::env::current_dir()
			.map_err(|error| tg::error!(source = error, "missing current dir"))?;

		// Get the tangram root path by walking up from the current directory.
		let mut search_dir = cwd.clone();
		while !search_dir.join(".tangram").exists() {
			let Some(parent) = search_dir.parent() else {
				return Err(tg::error!("missing tangram path"));
			};
			search_dir = parent.into();
		}
		let tangram_path = search_dir.join(".tangram");

		Ok(Self {
			rustc,
			stdin,
			dependencies,
			externs,
			rustc_output_directory,
			cargo_manifest_directory,
			cargo_out_directory,
			rustc_args,
			tangram_path,
		})
	}
}

#[tokio::main]
async fn main() {
	if let Err(e) = main_inner().await {
		eprintln!("rustc proxy failed: {e}");
		eprintln!("{}", e.trace(&tg::error::TraceOptions::default()));
		std::process::exit(1);
	}
}

async fn main_inner() -> tg::Result<()> {
	// Setup tracing.
	#[cfg(feature = "tracing")]
	setup_tracing();

	let args = Args::parse()?;
	#[cfg(feature = "tracing")]
	tracing::info!(?args, "parsed arguments");

	// If cargo expects to pipe into stdin or contains only a single arg, we immediately invoke rustc without doing anything.
	if args.stdin || args.rustc_args.len() < 2 {
		#[cfg(feature = "tracing")]
		tracing::info!("invoking rustc without tangram");
		let error = std::process::Command::new(std::env::args().nth(1).unwrap())
			.args(std::env::args().skip(2))
			.exec();
		return Err(tg::error!("exec failed: {error}."));
	}

	// Create a client.
	let tg = tg::Client::with_env()?;
	let tg = &tg;

	// Check in the source and output directories.
	let source_directory_path = args.cargo_manifest_directory;
	#[cfg(feature = "tracing")]
	tracing::info!(?source_directory_path, "checking in source directory");
	let source_directory = get_checked_in_path(tg, &source_directory_path).await?;
	let out_dir = if let Some(path) = &args.cargo_out_directory {
		let out_dir_path: tg::Path = path.parse().unwrap();
		#[cfg(feature = "tracing")]
		tracing::info!(?out_dir_path, "checking in output directory");
		get_checked_in_path(tg, &out_dir_path).await?
	} else {
		tg::Directory::new(BTreeMap::new()).into()
	};

	// Create the executable file.
	let contents = tg::Blob::with_reader(tg, DRIVER_SH).await?;
	let executable = true;
	let references = Vec::new();
	let object = tg::file::Object {
		contents,
		executable,
		references,
	};
	let executable = Some(tg::File::with_object(object).into());

	// Unrender the environment.
	// Get the artifacts directory.
	let mut artifacts_directory = None;
	let cwd = std::env::current_dir().expect("Failed to get the current directory");
	for path in cwd.ancestors().skip(1) {
		let directory = path.join(".tangram/artifacts");
		if directory.exists() {
			artifacts_directory = Some(directory);
			break;
		}
	}
	let artifacts_directory = artifacts_directory.expect("Failed to find the artifacts directory");
	let artifacts_directory = artifacts_directory
		.to_str()
		.expect("artifacts directory path is not valid UTF-8");
	let mut env = BTreeMap::new();
	for (name, value) in
		std::env::vars().filter(|(name, _)| !BLACKLISTED_ENV_VARS.contains(&name.as_str()))
	{
		let value = tg::Template::unrender(artifacts_directory, &value)?;
		env.insert(name, value.into());
	}

	// Create/Unrender the arguments passed to driver.sh.
	let rustc = tg::Template::unrender(artifacts_directory, &args.rustc)?;
	let name = "tangram_rustc".to_string().into();
	let mut target_args: Vec<tg::Value> = vec![
		name,
		"--rustc".to_owned().into(),
		rustc.into(),
		"--source".to_owned().into(),
		source_directory,
		"--out-dir".to_owned().into(),
		out_dir,
		"--".to_owned().into(),
	];

	for arg in &args.rustc_args {
		let template = tg::Template::unrender(artifacts_directory, arg)?;
		target_args.push(template.into());
	}

	// Check in any -L dependency=PATH directories, and splice any matching --extern name=PATH args.
	for dependency in &args.dependencies {
		#[cfg(feature = "tracing")]
		tracing::info!(?dependency, "checking in dependency");
		let directory = tg::Artifact::check_in(
			tg,
			tg::artifact::checkin::Arg {
				destructive: false,
				path: dependency.parse().unwrap(),
			},
		)
		.await?;
		let template = tg::Template {
			components: vec!["dependency=".to_owned().into(), directory.clone().into()],
		};
		target_args.extend(["-L".to_owned().into(), template.into()]);
		let externs = args
			.externs
			.iter()
			.filter_map(|(name, path)| {
				let template = if path.is_empty() {
					tg::Template {
						components: vec![name.to_string().into()],
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
				Some(["--extern".to_owned().into(), template.into()])
			})
			.flatten();
		target_args.extend(externs);
	}

	// Create the target.
	let host = host().to_string();
	let lock = None;
	let checksum = None;
	let object = tg::target::Object {
		executable,
		env,
		host,
		lock,
		args: target_args,
		checksum,
	};
	let target = tg::Target::with_object(object);
	let target_id = target.id(tg).await?;
	#[cfg(feature = "tracing")]
	tracing::info!(?target_id, "created target");

	// Create the build and mark it as a child.
	let build_options = tg::target::build::Arg {
		create: true,
		parent: None,
		remote: None,
		retry: tg::build::Retry::Failed,
	};
	#[cfg(feature = "tracing")]
	tracing::info!(?build_options, "building target");
	let build_output = tg.build_target(&target_id, build_options).await?;
	#[cfg(feature = "tracing")]
	tracing::info!(?build_output, "built target");

	// Get the build outcome.
	let outcome = tg::Build::with_id(build_output.build)
		.outcome(tg)
		.await
		.map_err(|error| tg::error!(source = error, "failed to get the build"))?;

	// Get the output.
	let output = match outcome {
		tg::build::Outcome::Canceled => return Err(tg::error!("Build was cancelled.")),
		tg::build::Outcome::Failed(error) => return Err(tg::error!("Build failed: {error}")),
		tg::build::Outcome::Succeeded(success) => success
			.try_unwrap_object()
			.map_err(|error| {
				tg::error!(source = error, "expected the build outcome to be an object")
			})?
			.try_unwrap_directory()
			.map_err(|error| {
				tg::error!(
					source = error,
					"expected the build output to be a directory"
				)
			})?,
	};
	#[cfg(feature = "tracing")]
	{
		let output_id = output.id(tg).await?;
		tracing::info!(?output_id, "got output");
	}

	// Get stdout/stderr from the build and forward it to our stdout/stderr.
	let stdout = output
		.get(tg, &"log/stdout".parse().unwrap())
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
		.get(tg, &"log/stderr".parse().unwrap())
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

	// Get the output directory.
	let output_directory = args
		.tangram_path
		.join("artifacts")
		.join(output.id(tg).await?.to_string())
		.join("build");

	// Copy output files from $OUTPUT to the path specified.
	for from in output_directory.read_dir().unwrap() {
		let filename = from.unwrap().file_name().into_string().unwrap();
		let from = output_directory.join(&filename);
		let to = PathBuf::from(args.rustc_output_directory.as_ref().unwrap()).join(filename);
		if from.exists() && from.is_file() {
			tokio::fs::copy(from, to)
				.await
				.map_err(|error| tg::error!(source = error, "failed to copy output directory"))?;
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

fn host() -> &'static str {
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
	"TANGRAM_RUSTC_TRACING",
	"TANGRAM_HOST",
	"TANGRAM_URL",
	"HOME",
	"OUTPUT",
];

/// Given a string path, return a [`tg::Path`] pointing to a checked-in artifact. If the path is already checked in, do nothing.
async fn get_checked_in_path(
	tg: &impl tg::Handle,
	path: &impl AsRef<std::path::Path>,
) -> tg::Result<tg::Value> {
	// If the path is in the working directory, check it in. If the path points to a checked-in artifact, return it as artifact/subpath (symlink)
	let path = path.as_ref();
	let path_str = path.to_str().unwrap();

	// Unrender the string.
	// We want to treat "checkouts" and "artifacts" as the same.
	let path_str = path_str.replace("checkouts", "artifacts");
	let symlink_data = template_data_to_symlink_data(unrender(tg, &path_str)).await?;
	#[cfg(feature = "tracing")]
	tracing::info!(?symlink_data, "unrendered symlink data");

	// If the symlink data has an artifact, check it out and return it.
	if symlink_data.artifact.is_some() {
		#[cfg(feature = "tracing")]
		tracing::info!(
			?symlink_data,
			"found artifact in symlink data, returning original value"
		);
		let root_dir = find_root_manifest_dir(&path_str).display().to_string();
		#[cfg(feature = "tracing")]
		tracing::info!(?root_dir, "found root directory");
		return Ok(root_dir.into());
	}

	#[cfg(feature = "tracing")]
	tracing::info!(?path, "no artifact found in symlink data, checking in");

	// Otherwise, check in the path.
	let path = tg::Path::try_from(path)?;
	let artifact = tg::Artifact::check_in(
		tg,
		tg::artifact::checkin::Arg {
			destructive: false,
			path,
		},
	)
	.await?;

	Ok(artifact.into())
}

/// Convert a [`tangram_client::template::Data`] to its corresponding [`tangram_client::symlink::Data`] object.
async fn template_data_to_symlink_data<F>(template: F) -> tg::Result<tg::symlink::Data>
where
	F: futures::Future<Output = tg::template::Data>,
{
	let components = template.await.components;
	match components.as_slice() {
		[tg::template::component::Data::String(s)] => Ok(tg::symlink::Data {
			artifact: None,
			path: Some(tg::Path::from(s)),
		}),
		[tg::template::component::Data::Artifact(id)]
		| [tg::template::component::Data::String(_), tg::template::component::Data::Artifact(id)] => {
			Ok(tg::symlink::Data {
				artifact: Some(id.clone()),
				path: None,
			})
		},
		[tg::template::component::Data::Artifact(artifact_id), tg::template::component::Data::String(s)]
		| [tg::template::component::Data::String(_), tg::template::component::Data::Artifact(artifact_id), tg::template::component::Data::String(s)] => {
			Ok(tg::symlink::Data {
				artifact: Some(artifact_id.clone()),
				path: Some(tg::Path::from(s)),
			})
		},
		_ => Err(tg::error!(
			"expected a template with 1-3 components, got {:?}",
			components
		)),
	}
}

/// Unrender a template string to its [`tangram_client::template::Data`] form.
async fn unrender(tg: &impl tg::Handle, string: &str) -> tg::template::Data {
	// Get the artifacts directory.
	let mut artifacts_directory = None;
	let cwd = std::env::current_dir().expect("Failed to get the current directory");
	for path in cwd.ancestors().skip(1) {
		let directory = path.join(".tangram/artifacts");
		if directory.exists() {
			artifacts_directory = Some(directory);
			break;
		}
	}
	let artifacts_directory = artifacts_directory.expect("Failed to find the artifacts directory");

	tg::Template::unrender(
		artifacts_directory
			.to_str()
			.expect("artifacts directory should be valid UTF-8"),
		string,
	)
	.expect("Failed to unrender template")
	.data(tg)
	.await
	.expect("Failed to produce template data from template")
}

#[cfg(feature = "tracing")]
fn setup_tracing() {
	// Create the env layer.
	let targets_layer = std::env::var("TANGRAM_RUSTC_TRACING")
		.ok()
		.and_then(|filter| filter.parse::<tracing_subscriber::filter::Targets>().ok());

	// If tracing is enabled, create and initialize the subscriber.
	if let Some(targets_layer) = targets_layer {
		let format_layer = tracing_subscriber::fmt::layer()
			.compact()
			.with_ansi(false)
			.with_span_events(tracing_subscriber::fmt::format::FmtSpan::NEW)
			.with_writer(std::io::stderr);
		let subscriber = tracing_subscriber::registry()
			.with(targets_layer)
			.with(format_layer);
		subscriber.init();
	}
}
