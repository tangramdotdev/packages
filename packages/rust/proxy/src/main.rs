use itertools::Itertools;
use std::{
	collections::BTreeMap,
	os::unix::process::CommandExt,
	path::{Path, PathBuf},
	str::FromStr,
	sync::LazyLock,
};
use tangram_client as tg;
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
	rustc_args: Vec<String>,

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
		let mut rustc_args = Vec::new();
		let cargo_out_directory = std::env::var("OUT_DIR").ok();

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
				(arg, None) if arg.starts_with("--out-dir=") => {
					if let Some(suffix) = arg.strip_prefix("--out-dir=") {
						rustc_output_directory = Some(suffix.into());
					}
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
		let cargo_manifest_directory = std::env::var("CARGO_MANIFEST_DIR").ok();

		// Determine the directory containing the source.
		let source_directory = if let Some(dir) = cargo_manifest_directory {
			// If cargo set CARGO_MANIFEST_DIR, it's that directory.
			dir
		} else {
			// Otherwise, it's the only argument left in the rustc_args with a ".rs" extension.
			let mut source_directory = None;
			for arg in &rustc_args {
				if arg.ends_with(".rs") {
					let path = std::path::Path::new(arg);
					let parent = path.parent();
					if let Some(parent) = parent {
						if let Some(parent_str) = parent.to_str() {
							source_directory = Some(parent_str.to_owned());
							break;
						}
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
			source_directory,
			cargo_out_directory,
			rustc_args,
		})
	}
}

fn main() {
	// Setup tracing.
	#[cfg(feature = "tracing")]
	setup_tracing("TANGRAM_RUSTC_TRACING");

	if let Err(e) = main_inner() {
		eprintln!("rustc proxy failed: {e}");
		eprintln!(
			"{}",
			e.trace(&tg::error::TraceOptions {
				internal: true,
				reverse: false,
			})
		);
		std::process::exit(1);
	}
}

fn main_inner() -> tg::Result<()> {
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

	tokio::runtime::Builder::new_multi_thread()
		.enable_all()
		.build()
		.unwrap()
		.block_on(run_proxy(args))?;

	Ok(())
}

/// Run the proxy.
async fn run_proxy(args: Args) -> tg::Result<()> {
	// Create a client.
	let tg = tg::Client::with_env()?;
	let tg = &tg;

	// Check in the source and output directories.
	let source_directory_path = args.source_directory;
	#[cfg(feature = "tracing")]
	tracing::info!(?source_directory_path, "checking in source directory");
	let source_directory = get_checked_in_path(tg, &source_directory_path).await?;
	let out_dir = if let Some(path) = &args.cargo_out_directory {
		let out_dir_path = std::path::PathBuf::from_str(path)
			.map_err(|source| tg::error!(!source, %path,  "unable to construct path"))?;
		#[cfg(feature = "tracing")]
		tracing::info!(?out_dir_path, "checking in output directory");
		get_checked_in_path(tg, &out_dir_path).await?
	} else {
		tg::Directory::with_entries(BTreeMap::new()).into()
	};

	// Create the executable file.
	let contents = tg::Blob::with_reader(tg, DRIVER_SH).await?;
	let executable = true;
	let dependencies = BTreeMap::new();
	let object = tg::file::Object::Normal {
		contents,
		dependencies,
		executable,
	};
	let executable = Some(tg::File::with_object(object).into());

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

		let value = unrender(&value)?;
		env.insert(name, value.into());
	}

	// Create/Unrender the arguments passed to driver.sh.
	let rustc = unrender(&args.rustc)?;
	let name = "tangram_rustc_proxy".to_string().into();
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

	for arg in &args.rustc_args {
		let template = unrender(arg)?;
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
				destructive: false,
				deterministic: true,
				ignore: false,
				locked: true,
				lockfile: false,
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
				components: vec![name.to_string().into()],
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
	let run_arg = tg::run::Arg {
		args: command_args,
		cwd: None,
		cached: None,
		checksum: None,
		env,
		executable,
		host: Some(host),
		mounts: None,
		network: Some(false),
		parent: None,
		remote: None,
		retry: false,
		stderr: None,
		stdout: None,
		stdin: None,
		user: None,
	};

	// Get the process output.
	let output = tg::run::run(tg, run_arg).await?;
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
	let artifact = tg::Artifact::from(output.clone()).id();
	let path = tg::checkout(
		tg,
		tg::checkout::Arg {
			artifact,
			dependencies: false,
			force: true,
			path: None,
			lockfile: false,
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

	// Copy output files from $OUTPUT to the path specified.
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
	"TANGRAM_RUSTC_TRACING",
	"TANGRAM_HOST",
	"TANGRAM_URL",
	"HOME",
	"OUTPUT",
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
	let symlink_data = template_data_to_symlink_data(unrender(path_str)?.to_data())?;
	#[cfg(feature = "tracing")]
	tracing::info!(?symlink_data, "unrendered symlink data");

	// If the symlink data has an artifact, check it out and return it.
	if let tg::symlink::Data::Artifact {
		artifact,
		subpath: _,
	} = symlink_data
	{
		#[cfg(feature = "tracing")]
		tracing::info!(
			?artifact,
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
	let artifact = tg::checkin(
		tg,
		tg::checkin::Arg {
			destructive: false,
			deterministic: true,
			ignore: false,
			locked: false,
			lockfile: false,
			path: path.to_path_buf(),
			updates: vec![],
		},
	)
	.await?;

	Ok(artifact.into())
}

#[cfg(feature = "tracing")]
use tracing_subscriber::{prelude::__tracing_subscriber_SubscriberExt, util::SubscriberInitExt};

/// Initialize tracing.
pub fn setup_tracing(var_name: &str) {
	// Create the env layer.
	let targets_layer = std::env::var(var_name)
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

/// Convert a [`tangram_client::template::Data`] to its corresponding [`tangram_client::symlink::Data`] object.
pub fn template_data_to_symlink_data(
	template: tg::template::Data,
) -> tg::Result<tg::symlink::Data> {
	let components = template.components;
	match components.as_slice() {
		[tg::template::component::Data::String(s)] => {
			Ok(tg::symlink::Data::Target { target: s.into() })
		},
		[tg::template::component::Data::Artifact(id)]
		| [
			tg::template::component::Data::String(_),
			tg::template::component::Data::Artifact(id),
		] => Ok(tg::symlink::Data::Artifact {
			artifact: id.clone(),
			subpath: None,
		}),
		[
			tg::template::component::Data::Artifact(artifact_id),
			tg::template::component::Data::String(s),
		]
		| [
			tg::template::component::Data::String(_),
			tg::template::component::Data::Artifact(artifact_id),
			tg::template::component::Data::String(s),
		] => Ok(tg::symlink::Data::Artifact {
			artifact: artifact_id.clone(),
			subpath: Some(s.chars().skip(1).collect::<String>().into()),
		}),
		_ => Err(tg::error!(
			"expected a template with 1-3 components, got {:?}",
			components
		)),
	}
}

/// Compute the closest located artifact path for the current running process, reusing the result for subsequent lookups.
pub static CLOSEST_ARTIFACT_PATH: LazyLock<String> = LazyLock::new(|| {
	let mut closest_artifact_path = None;
	let cwd = std::env::current_dir().expect("Failed to get the current directory");
	let paths = if cwd == Path::new("/") {
		vec![cwd.as_path()]
	} else {
		vec![]
	};
	for path in paths.into_iter().chain(cwd.ancestors().skip(1)) {
		let directory = path.join(".tangram/artifacts");
		if directory.exists() {
			closest_artifact_path = Some(
				directory
					.to_str()
					.expect("artifacts directory should be valid UTF-8")
					.to_string(),
			);
			break;
		}
	}
	closest_artifact_path.expect("Failed to find the closest artifact path")
});

/// Unrender a template string to a [`tangram_client::Template`] using the closest located artifact path.
pub fn unrender(string: &str) -> tg::Result<tg::Template> {
	tg::Template::unrender(&CLOSEST_ARTIFACT_PATH, string)
}
