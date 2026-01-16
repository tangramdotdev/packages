use std::{
	collections::BTreeMap,
	os::unix::{fs::PermissionsExt, process::CommandExt},
	path::PathBuf,
	pin::pin,
	str::FromStr,
};
use tangram_client::prelude::*;
use tangram_futures::stream::TryExt as _;
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

		let mut arg_iter = std::env::args().skip(2).peekable();
		while let Some(arg) = arg_iter.next() {
			let value = if ARGS_WITH_VALUES.contains(&arg.as_str())
				&& arg_iter.peek().is_some_and(|a| !a.starts_with('-'))
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
					let components: Vec<&str> = value.split('=').collect();
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
	// Check if we are running in driver mode (inside the Tangram sandbox).
	if std::env::var("TGRUSTC_DRIVER_MODE").is_ok() {
		return run_driver();
	}

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

/// Run in driver mode inside the Tangram sandbox, executing rustc.
fn run_driver() -> tg::Result<()> {
	#[cfg(feature = "tracing")]
	tracing::info!("running in driver mode");

	// Read required environment variables.
	let tangram_output = std::env::var("TANGRAM_OUTPUT")
		.map_err(|_| tg::error!("TANGRAM_OUTPUT not set in driver mode"))?;
	let rustc_path = std::env::var("TGRUSTC_RUSTC")
		.map_err(|_| tg::error!("TGRUSTC_RUSTC not set in driver mode"))?;
	let source_dir = std::env::var("TGRUSTC_SOURCE")
		.map_err(|_| tg::error!("TGRUSTC_SOURCE not set in driver mode"))?;
	let out_dir_source = std::env::var("TGRUSTC_OUT_DIR")
		.map_err(|_| tg::error!("TGRUSTC_OUT_DIR not set in driver mode"))?;

	#[cfg(feature = "tracing")]
	tracing::info!(
		?tangram_output,
		?rustc_path,
		?source_dir,
		?out_dir_source,
		"driver mode environment"
	);

	// Create output directories for build outputs and logs.
	let build_path = format!("{tangram_output}/build");
	let log_path = format!("{tangram_output}/log");

	std::fs::create_dir_all(&build_path)
		.map_err(|e| tg::error!("failed to create {build_path}: {e}"))?;
	std::fs::create_dir_all(&log_path)
		.map_err(|e| tg::error!("failed to create {log_path}: {e}"))?;

	// Use the OUT_DIR artifact path directly - no copy needed since rustc only reads from it.
	let out_path = out_dir_source.clone();

	#[cfg(feature = "tracing")]
	tracing::info!("using OUT_DIR artifact directly, setting up output redirection");

	// Collect rustc arguments from command line (skip argv[0] which is tgrustc).
	let rustc_args: Vec<String> = std::env::args().skip(1).collect();

	// Open log files for stdout/stderr capture.
	let stdout_file = std::fs::File::create(format!("{log_path}/stdout"))
		.map_err(|e| tg::error!("failed to create stdout log: {e}"))?;
	let stderr_file = std::fs::File::create(format!("{log_path}/stderr"))
		.map_err(|e| tg::error!("failed to create stderr log: {e}"))?;

	// Redirect stdout and stderr to the log files using rustix (safe wrapper).
	rustix::stdio::dup2_stdout(&stdout_file)
		.map_err(|e| tg::error!("failed to redirect stdout: {e}"))?;
	rustix::stdio::dup2_stderr(&stderr_file)
		.map_err(|e| tg::error!("failed to redirect stderr: {e}"))?;

	#[cfg(feature = "tracing")]
	tracing::info!(?rustc_args, "executing rustc");

	// Change to source directory and exec rustc.
	let error = std::process::Command::new(&rustc_path)
		.args(&rustc_args)
		.current_dir(&source_dir)
		.env("OUT_DIR", &out_path)
		.arg("--out-dir")
		.arg(&build_path)
		.exec();

	// If we get here, exec failed.
	Err(tg::error!("failed to exec rustc: {error}"))
}

/// Run the proxy.
#[allow(clippy::too_many_lines)]
async fn run_proxy(args: Args) -> tg::Result<()> {
	// Create a client.
	let tg = tg::Client::with_env()?;
	let tg = &tg;

	// Get the source directory. If TGRUSTC_WORKSPACE_SOURCE is set, use it directly
	// (it was already checked in by cargo.tg.ts). Otherwise, fall back to checking in
	// the source directory path.
	let source_directory: tg::Value =
		if let Ok(workspace_source) = std::env::var("TGRUSTC_WORKSPACE_SOURCE") {
			#[cfg(feature = "tracing")]
			tracing::info!(
				?workspace_source,
				"using pre-checked-in workspace source from TGRUSTC_WORKSPACE_SOURCE"
			);
			tangram_std::unrender(&workspace_source)?.into()
		} else {
			let source_directory_path = &args.source_directory;
			#[cfg(feature = "tracing")]
			tracing::info!(?source_directory_path, "checking in source directory");
			get_checked_in_path(tg, source_directory_path).await?
		};

	// Check in the cargo out directory (used for build script outputs like cc-rs compiled libs).
	// We store the original path, the artifact, and the wrapped Value for different uses:
	// - cargo_out_dir_path: for matching -L native=PATH args
	// - out_dir_artifact: for building -L native=<artifact> templates
	// - out_dir: for passing to --out-dir
	let (cargo_out_dir_path, out_dir_artifact, out_dir): (
		Option<String>,
		Option<tg::Artifact>,
		tg::Value,
	) = if let Some(path) = &args.cargo_out_directory {
		let out_dir_path = std::path::PathBuf::from_str(path)
			.map_err(|source| tg::error!(!source, %path,  "unable to construct path"))?;
		#[cfg(feature = "tracing")]
		tracing::info!(?out_dir_path, "checking in output directory");
		let artifact = tg::checkin(
			tg,
			tg::checkin::Arg {
				options: tg::checkin::Options {
					deterministic: true,
					ignore: false,
					lock: None,
					..Default::default()
				},
				path: out_dir_path,
				updates: vec![],
			},
		)
		.await?;
		let wrapped = tangram_std::template_from_artifact(artifact.clone()).into();
		(Some(path.clone()), Some(artifact), wrapped)
	} else {
		// Create an empty directory, store it, and wrap it in a template so it renders as a path.
		let empty_dir = tg::Directory::with_entries(BTreeMap::new());
		empty_dir.store(tg).await?;
		(
			None,
			None,
			tangram_std::template_from_artifact(empty_dir.into()).into(),
		)
	};

	// Use the tgrustc binary itself as the inner driver executable.
	let tgrustc_file = if let Ok(driver_exe_path) = std::env::var("TGRUSTC_DRIVER_EXECUTABLE") {
		#[cfg(feature = "tracing")]
		tracing::info!(
			?driver_exe_path,
			"using pre-passed driver executable artifact"
		);
		let template = tangram_std::unrender(&driver_exe_path)?;
		let artifact = template
			.components
			.into_iter()
			.next()
			.and_then(|c| c.try_unwrap_artifact().ok())
			.ok_or_else(|| tg::error!("expected artifact in TGRUSTC_DRIVER_EXECUTABLE"))?;
		artifact
			.try_unwrap_file()
			.map_err(|_| tg::error!("expected file artifact in TGRUSTC_DRIVER_EXECUTABLE"))?
	} else {
		// Fallback: check in current executable (for testing or direct invocation).
		let self_exe = std::env::current_exe()
			.map_err(|e| tg::error!("failed to get current executable path: {e}"))?;
		#[cfg(feature = "tracing")]
		tracing::info!(
			?self_exe,
			"checking in tgrustc binary as driver executable (fallback)"
		);
		let tgrustc_artifact = tg::checkin(
			tg,
			tg::checkin::Arg {
				options: tg::checkin::Options {
					deterministic: true,
					ignore: false,
					lock: None,
					..Default::default()
				},
				path: self_exe,
				updates: vec![],
			},
		)
		.await?;
		tgrustc_artifact
			.try_unwrap_file()
			.map_err(|_| tg::error!("expected tgrustc checkin to produce a file"))?
	};
	let executable: tg::command::Executable = tgrustc_file.into();

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
				.collect::<Vec<_>>()
				.join(" ")
		} else {
			value
		};

		let value = tangram_std::unrender(&value)?;
		env.insert(name, value.into());
	}

	// Set up driver mode environment variables.
	// These tell the inner tgrustc (running in driver mode) where things are.
	let rustc_template = tangram_std::unrender(&args.rustc)?;
	env.insert("TGRUSTC_DRIVER_MODE".to_owned(), "1".to_owned().into());
	env.insert("TGRUSTC_RUSTC".to_owned(), rustc_template.into());
	env.insert("TGRUSTC_SOURCE".to_owned(), source_directory.clone());
	env.insert("TGRUSTC_OUT_DIR".to_owned(), out_dir);
	#[cfg(feature = "tracing")]
	tracing::info!(?source_directory, "source_directory value for inner build");

	// Build command arguments - these are passed directly to rustc by the driver.
	// Tangram sets argv[0] from the executable, so we only pass the actual arguments.
	let mut command_args: Vec<tg::Value> = vec![];

	// Add remaining args (rustc flags, source files, etc).
	for arg in &args.remaining {
		// Check if this is a native= arg pointing to cargo_out_directory.
		if let Some(ref cargo_path) = cargo_out_dir_path
			&& let Some(ref artifact) = out_dir_artifact
			&& let Some(native_path) = arg.strip_prefix("native=")
			&& native_path == cargo_path
		{
			// Substitute with the checked-in artifact.
			#[cfg(feature = "tracing")]
			tracing::info!(
				?native_path,
				"substituting native lib path with checked-in artifact"
			);
			let template = tg::Template {
				components: vec!["native=".to_owned().into(), artifact.clone().into()],
			};
			command_args.push(template.into());
			continue;
		}
		let template = tangram_std::unrender(arg)?;
		command_args.push(template.into());
	}

	// Process extern crate arguments and dependency directories concurrently.
	let (extern_args, dep_args) = futures::future::try_join(
		process_externs(tg, &args.externs),
		process_dependencies(tg, &args.dependencies),
	)
	.await?;
	command_args.extend(extern_args);
	command_args.extend(dep_args);

	// Create the process.
	let host = host().to_string();
	#[cfg(feature = "tracing")]
	tracing::info!(?host, "creating inner process");

	// Log args for debugging before they are moved.
	#[cfg(feature = "tracing")]
	tracing::info!(?command_args, "full command args for inner process");

	// Build a command for the process.
	let command = tg::Command::builder(host, executable)
		.args(command_args)
		.env(env)
		.build();
	let command_id = command.store(tg).await?;
	let mut command_ref = tg::Referent::with_item(command_id);
	command_ref.options.name.replace("rustc".into());

	// Spawn the process.
	let mut spawn_arg = tg::process::spawn::Arg::with_command(command_ref);
	spawn_arg.network = false;

	#[cfg(feature = "tracing")]
	tracing::info!("spawning inner process");

	let stream = tg::Process::spawn(tg, spawn_arg).await?;
	let process = pin!(stream)
		.try_last()
		.await?
		.ok_or_else(|| tg::error!("expected an event"))?
		.try_unwrap_output()
		.ok()
		.ok_or_else(|| tg::error!("expected the output"))?;
	let process_id = process.id().clone();

	#[cfg(feature = "tracing")]
	tracing::info!(?process_id, "spawned inner process");

	// Wait for the process output.
	let output = match process.output(tg).await {
		Ok(output) => output,
		Err(e) => {
			eprintln!("Inner process failed. View logs with: tangram log {process_id}");
			#[cfg(feature = "tracing")]
			tracing::error!(?e, ?process_id, "inner process error details");
			return Err(e);
		},
	};
	let output = output
		.try_unwrap_object()
		.map_err(|source| {
			tg::error!(
				!source,
				"expected process {process_id} to produce an object"
			)
		})?
		.try_unwrap_directory()
		.map_err(|source| {
			tg::error!(
				!source,
				"expected process {process_id} to produce a directory"
			)
		})?;

	#[cfg(feature = "tracing")]
	{
		let output_id = output.id();
		tracing::info!(?output_id, "got output");
	}

	// Get stdout/stderr from the build. We'll forward them AFTER creating symlinks
	// to ensure cargo doesn't start dependent crates before our outputs are ready.
	let stdout = output
		.get(tg, &"log/stdout")
		.await?
		.try_unwrap_file()
		.unwrap()
		.contents(tg)
		.await?
		.bytes(tg)
		.await?;
	let stderr = output
		.get(tg, &"log/stderr")
		.await?
		.try_unwrap_file()
		.unwrap()
		.contents(tg)
		.await?
		.bytes(tg)
		.await?;

	// Get the build directory from the output artifact.
	let build_dir = output
		.get(tg, "build")
		.await?
		.try_unwrap_directory()
		.map_err(|_| {
			tg::error!("expected 'build' directory in output from process {process_id}")
		})?;
	#[cfg(feature = "tracing")]
	{
		let build_dir_id = build_dir.id();
		tracing::info!(?build_dir_id, "got build directory");
	}

	// Write outputs to cargo's output directory.
	let output_directory = PathBuf::from(args.rustc_output_directory.as_ref().unwrap());
	write_outputs_to_cargo(tg, &build_dir, &output_directory).await?;

	// Now that symlinks are created, forward stdout/stderr.
	// Cargo watches for JSON output indicating the .rmeta file is ready.
	tokio::io::stdout()
		.write_all(&stdout)
		.await
		.map_err(|error| tg::error!(source = error, "failed to write stdout"))?;
	tokio::io::stderr()
		.write_all(&stderr)
		.await
		.map_err(|error| tg::error!(source = error, "failed to write stderr"))?;

	Ok(())
}

/// Check in extern crate dependencies.
///
/// Each extern file is wrapped in a directory with a symlink to preserve the filename
/// (rustc requires .rlib/.dylib extensions). Returns command args to add.
async fn process_externs(
	tg: &impl tg::Handle,
	externs: &[(String, String)],
) -> tg::Result<Vec<tg::Value>> {
	// Sort externs by name for deterministic cache hits.
	let mut sorted_externs = externs.to_vec();
	sorted_externs.sort_by(|a, b| a.0.cmp(&b.0));

	// Separate empty-path externs (no async work) from non-empty ones.
	let mut empty_path_args = Vec::new();
	let mut extern_work = Vec::new();

	for (name, path) in &sorted_externs {
		if path.is_empty() {
			empty_path_args.push((name.clone(), path.clone()));
		} else {
			// Follow symlink if needed (sync I/O).
			let file_path = PathBuf::from(path);
			let target_path = if file_path.is_symlink() {
				let target = std::fs::read_link(&file_path).map_err(|e| {
					tg::error!(
						source = e,
						"failed to read symlink target for extern crate '{name}' at path '{path}'"
					)
				})?;
				#[cfg(feature = "tracing")]
				tracing::info!(?path, ?target, "following symlink to real file");
				target.to_str().unwrap_or(path).to_owned()
			} else {
				path.clone()
			};

			// Extract filename (sync).
			let filename = file_path
				.file_name()
				.and_then(|s| s.to_str())
				.ok_or_else(|| {
					tg::error!("extern path for crate '{name}' has no filename: {path}")
				})?
				.to_owned();

			extern_work.push((name.clone(), path.clone(), target_path, filename));
		}
	}

	// Process all non-empty externs concurrently.
	let futures = extern_work
		.iter()
		.map(|(name, path, target_path, filename)| {
			let name = name.clone();
			let path = path.clone();
			let target_path = target_path.clone();
			let filename = filename.clone();
			async move {
				// Resolve the path to an artifact.
				let file_artifact = resolve_path_to_artifact(tg, &target_path).await?;

				// Wrap the file in a directory with a symlink to the artifact.
				let file_artifact = file_artifact.try_unwrap_file().map_err(|e| {
					tg::error!(
						"expected extern crate '{name}' at '{path}' to be a file, got: {e:?}"
					)
				})?;
				let symlink = tg::Symlink::with_artifact(file_artifact.into());
				let wrapped_dir =
					tg::Directory::with_entries([(filename.clone(), symlink.into())].into());
				wrapped_dir.store(tg).await?;

				// Build --extern name=<wrapped_dir>/<filename>
				let template = tg::Template {
					components: vec![
						format!("{name}=").into(),
						wrapped_dir.into(),
						format!("/{filename}").into(),
					],
				};
				Ok::<_, tg::Error>(vec!["--extern".to_owned().into(), template.into()])
			}
		});
	let results: Vec<Vec<tg::Value>> = futures::future::try_join_all(futures).await?;

	// Collect all args in sorted order (empty paths first by their position, then non-empty).
	let mut command_args = Vec::new();
	let mut empty_iter = empty_path_args.iter().peekable();
	let mut result_iter = results.into_iter();
	for (name, path) in &sorted_externs {
		if path.is_empty() {
			if empty_iter.next().is_some() {
				command_args.extend(["--extern".to_owned().into(), name.clone().into()]);
			}
		} else if let Some(args) = result_iter.next() {
			command_args.extend(args);
		}
	}

	Ok(command_args)
}

/// Process dependency directories, merging all files into a single artifact directory.
async fn process_dependencies(
	tg: &impl tg::Handle,
	dependencies: &[String],
) -> tg::Result<Vec<tg::Value>> {
	// Sort for deterministic cache hits.
	let mut sorted_deps = dependencies.to_vec();
	sorted_deps.sort();

	// Collect all files to process.
	let mut files_to_process: Vec<(String, String)> = Vec::new();
	for dependency in &sorted_deps {
		#[cfg(feature = "tracing")]
		tracing::info!(?dependency, "scanning dependency directory for files");
		let dep_path = std::path::Path::new(dependency);
		if dep_path.is_dir()
			&& let Ok(entries) = std::fs::read_dir(dep_path)
		{
			for entry in entries.flatten() {
				let file_path = entry.path();
				let Some(filename) = file_path.file_name().and_then(|s| s.to_str()) else {
					continue;
				};
				// Handle symlinks first, then regular files.
				let target_path = if file_path.is_symlink() {
					if let Ok(target) = std::fs::read_link(&file_path) {
						#[cfg(feature = "tracing")]
						tracing::info!(?file_path, ?target, "found symlink in deps directory");
						target.to_str().unwrap_or_default().to_owned()
					} else {
						continue;
					}
				} else if file_path.is_file() {
					file_path.to_str().unwrap_or_default().to_owned()
				} else {
					continue;
				};
				files_to_process.push((filename.to_owned(), target_path));
			}
		}
	}

	// Sort and deduplicate by filename for determinism.
	files_to_process.sort_by(|a, b| a.0.cmp(&b.0));
	files_to_process.dedup_by(|a, b| a.0 == b.0);

	// Process all files concurrently.
	let process_futures = files_to_process.iter().map(|(filename, target_path)| {
		let filename = filename.clone();
		let target_path = target_path.clone();
		async move {
			let artifact = resolve_path_to_artifact(tg, &target_path).await.ok()?;
			Some((filename, artifact))
		}
	});
	let process_results: Vec<Option<(String, tg::Artifact)>> =
		futures::future::join_all(process_futures).await;

	// Collect successful results into symlinks for a merged directory.
	let merged_entries: BTreeMap<String, tg::Artifact> = process_results
		.into_iter()
		.flatten()
		.map(|(name, artifact)| {
			let symlink = tg::Symlink::with_artifact(artifact);
			(name, symlink.into())
		})
		.collect();

	// Create a merged directory containing symlinks to all the dependency files.
	let mut command_args = Vec::new();
	if !merged_entries.is_empty() {
		let merged_dir = tg::Directory::with_entries(merged_entries);
		merged_dir.store(tg).await?;
		let template = tg::Template {
			components: vec!["dependency=".to_owned().into(), merged_dir.into()],
		};
		command_args.extend(["-L".to_owned().into(), template.into()]);
	}

	Ok(command_args)
}

/// Write build outputs to cargo's output directory.
///
/// Dependencies (.rlib, .rmeta, .d) are symlinked for speed and atomicity.
/// Final binaries are copied so they appear as real files.
async fn write_outputs_to_cargo(
	tg: &impl tg::Handle,
	build_dir: &tg::Directory,
	output_directory: &PathBuf,
) -> tg::Result<()> {
	// Create the output directory if it does not exist.
	if !output_directory.exists() {
		tokio::fs::create_dir_all(output_directory)
			.await
			.map_err(|error| {
				tg::error!(
					source = error,
					"failed to create output directory {}",
					output_directory.display()
				)
			})?;
	}

	// Collect entries first, then process concurrently.
	let entries: Vec<_> = build_dir.entries(tg).await?.into_iter().collect();

	let futures = entries.into_iter().map(|(filename, artifact)| {
		let output_directory = output_directory.clone();
		async move {
			let to = output_directory.join(&filename);

			// Remove existing file/symlink if present.
			if to.exists() || to.is_symlink() {
				tokio::fs::remove_file(&to).await.ok();
			}

			// Check if this is a dependency file (symlink) or a final binary (copy).
			let is_dependency = std::path::Path::new(&filename)
				.extension()
				.is_some_and(|ext| {
					ext.eq_ignore_ascii_case("rlib")
						|| ext.eq_ignore_ascii_case("rmeta")
						|| ext.eq_ignore_ascii_case("d")
				});

			if is_dependency {
				// Create symlink for dependencies using CLOSEST_ARTIFACT_PATH.
				let artifact_id = artifact.id();
				let from = PathBuf::from(&*tangram_std::CLOSEST_ARTIFACT_PATH)
					.join(artifact_id.to_string());
				tokio::fs::symlink(&from, &to).await.map_err(|error| {
					tg::error!(
						source = error,
						"failed to create symlink from {} to {}",
						to.display(),
						from.display()
					)
				})?;
			} else {
				// Copy final binaries by reading bytes from the artifact.
				let file = artifact
					.try_unwrap_file()
					.map_err(|_| tg::error!("expected file artifact for {}", filename))?;
				let bytes = file.bytes(tg).await?;
				tokio::fs::write(&to, &bytes).await.map_err(|error| {
					tg::error!(source = error, "failed to write file {}", to.display())
				})?;
				// Make the file executable.
				let permissions = std::fs::Permissions::from_mode(0o755);
				tokio::fs::set_permissions(&to, permissions)
					.await
					.map_err(|error| {
						tg::error!(
							source = error,
							"failed to set permissions on {}",
							to.display()
						)
					})?;
			}

			Ok::<_, tg::Error>(())
		}
	});

	futures::future::try_join_all(futures).await?;

	Ok(())
}

// List of rustc args that take a value.
const ARGS_WITH_VALUES: [&str; 31] = [
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
	"--remap-path-prefix",
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
const BLACKLISTED_ENV_VARS: [&str; 7] = [
	"TGRUSTC_TRACING",
	"TGRUSTC_WORKSPACE_SOURCE",
	"TGRUSTC_DRIVER_EXECUTABLE",
	"TANGRAM_HOST",
	"TANGRAM_URL",
	"HOME",
	"TANGRAM_OUTPUT",
];

/// Resolve a path to an artifact.
///
/// If the path contains "/.tangram/artifacts/", it is unrendered to extract the artifact
/// directly. If the artifact has a subpath, we navigate to get the inner artifact.
/// Otherwise, the path is checked in as a new artifact.
///
/// This pattern is used for both extern paths and dependency paths where files may be
/// symlinks pointing to artifact paths from previous rustc invocations.
async fn resolve_path_to_artifact(
	tg: &impl tg::Handle,
	target_path: &str,
) -> tg::Result<tg::Artifact> {
	if target_path.contains("/.tangram/artifacts/") {
		#[cfg(feature = "tracing")]
		tracing::info!(?target_path, "unrendering artifact path");
		let template = tangram_std::unrender(target_path)?;
		let mut components = template.components.into_iter();
		let artifact = components
			.next()
			.and_then(|c| c.try_unwrap_artifact().ok())
			.ok_or_else(|| tg::error!("expected artifact in path: {target_path}"))?;
		// If there is a subpath, navigate to get the inner artifact.
		if let Some(component) = components.next() {
			let subpath = component
				.try_unwrap_string()
				.map_err(|_| tg::error!("expected string subpath in path: {target_path}"))?;
			let subpath = subpath.trim_start_matches('/');
			let dir = artifact.try_unwrap_directory().map_err(|_| {
				tg::error!("expected directory artifact for subpath in: {target_path}")
			})?;
			dir.get(tg, subpath).await
		} else {
			Ok(artifact)
		}
	} else {
		#[cfg(feature = "tracing")]
		tracing::info!(?target_path, "checking in file");
		tg::checkin(
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
				path: target_path
					.parse()
					.map_err(|e| tg::error!("failed to parse path {target_path}: {e}"))?,
				updates: vec![],
			},
		)
		.await
	}
}

/// Given a string path, check it in and return a template wrapping the artifact.
/// If the path is ".", returns "." directly.
///
/// Note: This function is only used for standalone rustc invocations (not cargo builds).
/// When using cargo.tg.ts, `TGRUSTC_WORKSPACE_SOURCE` is set and this function is bypassed.
async fn get_checked_in_path(
	tg: &impl tg::Handle,
	path: &impl AsRef<std::path::Path>,
) -> tg::Result<tg::Value> {
	let path = path.as_ref();
	let path_str = path.to_str().unwrap();

	if path_str == "." {
		return Ok(".".into());
	}

	#[cfg(feature = "tracing")]
	tracing::info!(?path, "checking in source directory");

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
