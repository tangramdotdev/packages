use futures::TryStreamExt as _;
use std::{
	collections::BTreeMap,
	os::unix::process::CommandExt,
	path::{Path, PathBuf},
	pin::pin,
	str::FromStr,
};
use tangram_client::prelude::*;
use tangram_futures::stream::TryExt as _;
use tokio::io::AsyncWriteExt;

/// Stats for a single rustc invocation, written to JSONL file.
#[cfg(feature = "tracing")]
#[derive(serde::Serialize)]
struct RustcStats {
	/// The name of the crate being compiled.
	crate_name: String,
	/// Whether this invocation was a cache hit.
	cached: bool,
	/// Total elapsed time in milliseconds for the proxy invocation.
	elapsed_ms: u128,
	/// The process ID spawned for this invocation.
	process_id: String,
	/// The command ID for this invocation (determines cache key).
	command_id: String,
}

/// Input arguments to the rustc proxy.
#[derive(Debug)]
struct Args {
	rustc: String,
	stdin: bool,
	crate_name: String,
	dependencies: Vec<String>,
	externs: Vec<(String, String)>,
	rustc_output_directory: Option<String>,
	remaining: Vec<String>,
	source_directory: String,
	cargo_out_directory: Option<String>,
}

impl Args {
	fn parse() -> tg::Result<Self> {
		let rustc = std::env::args()
			.nth(1)
			.ok_or(tg::error!("missing argument for rustc"))?;
		let mut stdin = false;
		let mut crate_name = None;
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
				("--crate-name", Some(name)) => {
					crate_name = Some(name.clone());
					remaining.push(arg);
					remaining.push(name);
				},
				("-L", Some(value)) if value.starts_with("dependency=") => {
					dependencies.push(value.strip_prefix("dependency=").unwrap().into());
				},
				("--extern", Some(value)) => {
					let parts: Vec<&str> = value.splitn(2, '=').collect();
					let (name, path) = match parts.len() {
						1 => (parts[0], ""),
						_ => (parts[0], parts[1]),
					};
					externs.push((name.into(), path.into()));
				},
				("--out-dir", Some(value)) => rustc_output_directory = Some(value),
				(arg, None) if arg.starts_with("--out-dir=") => {
					rustc_output_directory = arg.strip_prefix("--out-dir=").map(Into::into);
				},
				("-", None) => {
					stdin = true;
					remaining.push("-".into());
				},
				(_, None) => remaining.push(arg),
				(_, Some(value)) => {
					remaining.push(arg);
					remaining.push(value);
				},
			}
		}

		// Determine source directory from CARGO_MANIFEST_DIR or .rs file path.
		let source_directory = std::env::var("CARGO_MANIFEST_DIR").ok().unwrap_or_else(|| {
			remaining
				.iter()
				.find(|arg| {
					std::path::Path::new(arg)
						.extension()
						.is_some_and(|ext| ext.eq_ignore_ascii_case("rs"))
				})
				.and_then(|arg| {
					std::path::Path::new(arg)
						.parent()
						.and_then(|p| p.to_str())
						.map(ToOwned::to_owned)
				})
				.unwrap_or_else(|| ".".into())
		});

		Ok(Self {
			rustc,
			stdin,
			crate_name: crate_name.unwrap_or_else(|| "unknown".into()),
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
	#[cfg(feature = "tracing")]
	let start_time = std::time::Instant::now();
	#[cfg(feature = "tracing")]
	let _span = tracing::info_span!("rustc_proxy", crate = %args.crate_name).entered();

	// Create a client.
	let tg = tg::Client::with_env()?;
	let tg = &tg;

	// Resolve the crate source directory. For fine-grained caching, we navigate into
	// workspace subpaths to get stable artifact IDs for individual crates.
	let (source_directory, crate_subpath): (tg::Value, Option<String>) = {
		let manifest_dir = &args.source_directory;

		if manifest_dir.contains("/.tangram/artifacts/") {
			let (artifact, subpath) = extract_artifact_from_path(tg, manifest_dir).await?;
			#[cfg(feature = "tracing")]
			tracing::info!(id = ?artifact.id(), ?subpath, "resolved crate source");
			(tangram_std::template_from_artifact(artifact).into(), subpath)
		} else if let Ok(workspace_source) = std::env::var("TGRUSTC_WORKSPACE_SOURCE") {
			(tangram_std::unrender(&workspace_source)?.into(), None)
		} else {
			(checkin_path(tg, manifest_dir).await?, None)
		}
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
	) = {
		#[cfg(feature = "tracing")]
		let _span = tracing::info_span!("checkin_out_dir").entered();

		if let Some(path) = &args.cargo_out_directory {
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
		}
	};

	// Get the driver executable (tgrustc itself).
	let executable: tg::command::Executable = if let Ok(path) = std::env::var("TGRUSTC_DRIVER_EXECUTABLE") {
		let (artifact, _) = extract_artifact_from_path(tg, &path).await?;
		artifact
			.try_unwrap_file()
			.map_err(|_| tg::error!("expected file in TGRUSTC_DRIVER_EXECUTABLE"))?
			.into()
	} else {
		// Fallback: check in current executable for testing.
		let self_exe = std::env::current_exe()
			.map_err(|e| tg::error!("failed to get current executable: {e}"))?;
		let artifact = tg::checkin(
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
		artifact
			.try_unwrap_file()
			.map_err(|_| tg::error!("expected file from tgrustc checkin"))?
			.into()
	};

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
		} else if name == "DYLD_FALLBACK_LIBRARY_PATH" || name == "LD_LIBRARY_PATH" {
			// These may contain build-specific temp paths. Keep only stable paths:
			// - System library paths (/usr/lib, /usr/local/lib, /lib, /lib64)
			// - Artifact paths (contain /.tangram/artifacts/)
			// Temp build paths like /target/release/deps are redundant since we pass -L dependency=.
			value
				.split(':')
				.filter(|path| {
					path.starts_with("/usr/lib")
						|| path.starts_with("/usr/local/lib")
						|| path.starts_with("/lib")
						|| path.contains("/.tangram/artifacts/")
				})
				.collect::<Vec<_>>()
				.join(":")
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
	// Set CARGO_MANIFEST_DIR for proc-macros that read Cargo.toml.
	env.insert("CARGO_MANIFEST_DIR".to_owned(), source_directory.clone());
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

		// Rewrite source file paths to be crate-relative for cache key stability.
		// Cargo passes paths like "packages/greeting/src/lib.rs" (relative to workspace).
		// We rewrite these to "src/lib.rs" (relative to crate) since we set current_dir
		// to the crate directory.
		if let Some(ref subpath) = crate_subpath {
			// Check if this arg is a source file within the crate subpath.
			let is_source_file = std::path::Path::new(arg)
				.extension()
				.is_some_and(|ext| ext.eq_ignore_ascii_case("rs"))
				&& !arg.starts_with('-')
				&& !arg.contains("/.tangram/");
			if is_source_file {
				// Try to strip the crate subpath prefix.
				// Handle both "packages/greeting/src/lib.rs" and "packages/greeting/src/lib.rs".
				let stripped = arg
					.strip_prefix(subpath)
					.or_else(|| arg.strip_prefix(&format!("{subpath}/")))
					.map(|s| s.trim_start_matches('/'));

				if let Some(relative_path) = stripped {
					#[cfg(feature = "tracing")]
					tracing::info!(
						original = %arg,
						rewritten = %relative_path,
						"rewrote source file path to be crate-relative"
					);
					command_args.push(relative_path.to_owned().into());
					continue;
				}
			}
		}

		let template = tangram_std::unrender(arg)?;
		command_args.push(template.into());
	}

	// Process extern crate arguments and dependency directories concurrently.
	let (extern_args, dep_args) = {
		#[cfg(feature = "tracing")]
		let _span = tracing::info_span!(
			"process_deps",
			externs = args.externs.len(),
			deps = args.dependencies.len()
		)
		.entered();

		futures::future::try_join(
			process_externs(tg, &args.externs),
			process_dependencies(tg, &args.dependencies, &args.externs),
		)
		.await?
	};
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
	let mut command_ref = tg::Referent::with_item(command_id.clone());
	command_ref.options.name.replace("rustc".into());

	// Spawn the process.
	let (process, process_id) = {
		#[cfg(feature = "tracing")]
		let _span = tracing::info_span!("spawn_process").entered();

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

		(process, process_id)
	};

	// Wait for the process output.
	let output = {
		#[cfg(feature = "tracing")]
		let _span = tracing::info_span!("wait_output").entered();

		match process.output(tg).await {
			Ok(output) => output,
			Err(e) => {
				eprintln!("Inner process failed. View logs with: tangram log {process_id}");
				#[cfg(feature = "tracing")]
				tracing::error!(?e, ?process_id, "inner process error details");
				return Err(e);
			},
		}
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

	// Cache hit = no token was assigned (process was already finished when spawned).
	#[cfg(feature = "tracing")]
	let cached = process.token().is_none();

	#[cfg(feature = "tracing")]
	{
		let output_id = output.id();
		tracing::info!(?output_id, cached, "got output");
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
	{
		#[cfg(feature = "tracing")]
		let _span = tracing::info_span!("write_outputs").entered();

		let output_directory = PathBuf::from(args.rustc_output_directory.as_ref().unwrap());
		write_outputs_to_cargo(tg, &build_dir, &output_directory, &args.externs).await?;
	}

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

	#[cfg(feature = "tracing")]
	{
		let elapsed = start_time.elapsed();
		tracing::info!(
			crate_name = %args.crate_name,
			elapsed_ms = elapsed.as_millis(),
			cached,
			process_id = %process_id,
			"proxy_complete"
		);
		if let Ok(stats_file) = std::env::var("TGRUSTC_STATS_FILE") {
			let stats = RustcStats {
				crate_name: args.crate_name.clone(),
				cached,
				elapsed_ms: elapsed.as_millis(),
				process_id: process_id.to_string(),
				command_id: command_id.to_string(),
			};
			write_stats_line(&stats_file, &stats)?;
		}
	}

	Ok(())
}

/// Process extern crate dependencies into command args.
async fn process_externs(
	tg: &impl tg::Handle,
	externs: &[(String, String)],
) -> tg::Result<Vec<tg::Value>> {
	let mut sorted = externs.to_vec();
	sorted.sort_by(|a, b| a.0.cmp(&b.0));

	// Build futures for each extern, returning Option to distinguish empty vs non-empty paths.
	let futures = sorted.iter().map(|(name, path)| {
		let name = name.clone();
		let path = path.clone();
		async move {
			if path.is_empty() {
				return Ok(vec!["--extern".to_owned().into(), name.into()]);
			}

			// Follow symlinks and resolve to artifact.
			let file_path = PathBuf::from(&path);
			let target = if file_path.is_symlink() {
				std::fs::read_link(&file_path)
					.ok()
					.and_then(|t| t.to_str().map(ToOwned::to_owned))
					.unwrap_or(path.clone())
			} else {
				path.clone()
			};
			let filename = file_path
				.file_name()
				.and_then(|s| s.to_str())
				.ok_or_else(|| tg::error!("extern path has no filename: {path}"))?
				.to_owned();

			let artifact = resolve_path_to_artifact(tg, &target)
				.await?
				.try_unwrap_file()
				.map_err(|_| tg::error!("expected file for extern crate '{name}'"))?;

			// Wrap in directory to preserve filename.
			let wrapped = tg::Directory::with_entries(
				[(filename.clone(), tg::Symlink::with_artifact(artifact.into()).into())].into(),
			);
			wrapped.store(tg).await?;

			let template = tg::Template {
				components: vec![format!("{name}=").into(), wrapped.into(), format!("/{filename}").into()],
			};
			Ok::<_, tg::Error>(vec!["--extern".to_owned().into(), template.into()])
		}
	});

	let results: Vec<Vec<tg::Value>> = futures::future::try_join_all(futures).await?;
	Ok(results.into_iter().flatten().collect())
}

/// Extract crate name from a library or dep-info filename.
/// Formats:
/// - lib{crate_name}-{hash}.{rlib,rmeta,so,dylib}
/// - {crate_name}-{hash}.d (dep-info files don't have lib prefix)
fn extract_crate_name(filename: &str) -> Option<&str> {
	// Strip lib prefix if present (rlib/rmeta have it, .d files don't).
	let rest = filename.strip_prefix("lib").unwrap_or(filename);
	// Find the last '-' followed by a hash (alphanumeric) and extension.
	// Crate names can contain underscores and hyphens get converted to underscores.
	let dash_pos = rest.rfind('-')?;
	Some(&rest[..dash_pos])
}

/// Compute the transitive dependency closure starting from extern crates.
///
/// Uses `.externs` sidecar files written by previous tgrustc invocations to
/// find the dependencies of each extern crate, then recursively computes the
/// full transitive closure.
fn compute_transitive_closure(
	dependencies: &[String],
	externs: &[(String, String)],
) -> std::collections::HashSet<String> {
	use std::collections::{HashMap, HashSet, VecDeque};

	// Build a map of crate_name -> externs from .externs sidecar files.
	let mut externs_map: HashMap<String, Vec<String>> = HashMap::new();
	for dep_dir in dependencies {
		let Ok(entries) = std::fs::read_dir(dep_dir) else { continue };
		for entry in entries.flatten() {
			let path = entry.path();
			if path.extension().is_some_and(|ext| ext == "externs")
				&& let Some(crate_name) = path
					.file_stem()
					.and_then(|s| s.to_str())
					.and_then(extract_crate_name)
				&& let Ok(content) = std::fs::read_to_string(&path)
			{
				let deps: Vec<String> = content
					.lines()
					.map(|s| s.trim().to_owned())
					.filter(|s| !s.is_empty())
					.collect();
				externs_map.insert(crate_name.to_owned(), deps);
			}
		}
	}

	// BFS to compute transitive closure.
	let mut closure: HashSet<String> = HashSet::new();
	let mut queue: VecDeque<String> = externs.iter().map(|(name, _)| name.clone()).collect();

	while let Some(crate_name) = queue.pop_front() {
		if !closure.insert(crate_name.clone()) {
			continue; // Already processed.
		}
		// Add this crate's dependencies to the queue.
		if let Some(deps) = externs_map.get(&crate_name) {
			for dep in deps {
				if !closure.contains(dep) {
					queue.push_back(dep.clone());
				}
			}
		}
	}

	closure
}

/// Process dependency directories into a merged artifact directory.
///
/// Computes the transitive dependency closure from extern crates using `.externs`
/// sidecar files, then includes only files for crates in that closure. This ensures
/// deterministic cache keys regardless of cargo's parallel compilation order.
async fn process_dependencies(
	tg: &impl tg::Handle,
	dependencies: &[String],
	externs: &[(String, String)],
) -> tg::Result<Vec<tg::Value>> {
	// Compute the transitive dependency closure.
	let needed_crates = compute_transitive_closure(dependencies, externs);

	// Collect files from dependency directories, filtered to needed crates.
	let mut files: Vec<(String, String)> = Vec::new();
	for dep in dependencies {
		let Ok(entries) = std::fs::read_dir(dep) else { continue };
		for entry in entries.flatten() {
			let path = entry.path();
			let Some(name) = path.file_name().and_then(|s| s.to_str()) else { continue };
			// Skip .d and .externs files.
			let ext = path.extension();
			if ext.is_some_and(|e| e == "d" || e == "externs") {
				continue;
			}
			// Filter to crates in our transitive closure.
			let Some(crate_name) = extract_crate_name(name) else { continue };
			if !needed_crates.contains(crate_name) {
				continue;
			}
			// Include symlinks (following to their targets) and regular files.
			let target = if path.is_symlink() {
				std::fs::read_link(&path)
					.ok()
					.and_then(|t| t.to_str().map(ToOwned::to_owned))
			} else if path.is_file() {
				path.to_str().map(ToOwned::to_owned)
			} else {
				None
			};
			if let Some(target) = target {
				files.push((name.to_owned(), target));
			}
		}
	}

	// Sort and deduplicate for determinism.
	files.sort_by(|a, b| a.0.cmp(&b.0));
	files.dedup_by(|a, b| a.0 == b.0);

	// Resolve all files to artifacts concurrently and collect them for caching.
	// Resolve all files to artifacts concurrently.
	let futures = files.iter().map(|(name, path)| {
		let name = name.clone();
		let path = path.clone();
		async move {
			resolve_path_to_artifact(tg, &path)
				.await
				.ok()
				.map(|a| (name, tg::Symlink::with_artifact(a)))
		}
	});
	let entries: BTreeMap<String, tg::Artifact> = futures::future::join_all(futures)
		.await
		.into_iter()
		.flatten()
		.map(|(n, s)| (n, s.into()))
		.collect();

	if entries.is_empty() {
		return Ok(vec![]);
	}

	let merged = tg::Directory::with_entries(entries);
	merged.store(tg).await?;
	let template = tg::Template {
		components: vec!["dependency=".to_owned().into(), merged.into()],
	};
	Ok(vec!["-L".to_owned().into(), template.into()])
}

/// Strip the rustc metadata suffix from a filename and convert underscores to hyphens.
///
/// For example, `build_script_build-237322e67a6e148f` becomes `build-script-build`.
/// Returns `None` if the filename does not have a valid metadata suffix.
fn strip_metadata_suffix(filename: &str) -> Option<String> {
	// Find the last hyphen, which separates the crate name from the metadata.
	let hyphen_pos = filename.rfind('-')?;
	let (name, suffix) = filename.split_at(hyphen_pos);

	// The suffix (after the hyphen) should be a hex string (rustc metadata).
	let metadata = &suffix[1..]; // Skip the hyphen.
	if metadata.is_empty() || !metadata.chars().all(|c| c.is_ascii_hexdigit()) {
		return None;
	}

	// Convert underscores to hyphens in the crate name.
	Some(name.replace('_', "-"))
}

/// Create a symlink from `target` pointing to the artifact in the local store.
async fn symlink_artifact(
	tg: &impl tg::Handle,
	artifact: &tg::Artifact,
	target: &Path,
) -> tg::Result<()> {
	// Ensure the artifact is cached so it is accessible via the VFS.
	let arg = tg::cache::Arg {
		artifacts: vec![artifact.id()],
	};
	tg.cache(arg)
		.await
		.map_err(|error| tg::error!(source = error, "failed to cache artifact"))?
		.try_collect::<Vec<_>>()
		.await
		.map_err(|error| tg::error!(source = error, "failed to cache artifact"))?;

	let from =
		PathBuf::from(&*tangram_std::CLOSEST_ARTIFACT_PATH).join(artifact.id().to_string());
	tokio::fs::symlink(&from, target)
		.await
		.map_err(|error: std::io::Error| {
			tg::error!(
				source = error,
				"failed to symlink {} to {}",
				target.display(),
				from.display()
			)
		})
}

/// Write build outputs to cargo's output directory.
///
/// All outputs are symlinked to the artifact store for speed and atomicity.
/// For binaries with metadata suffixes, also creates convenience symlinks
/// (e.g., `build_script_build-abc123` gets a `build-script-build` symlink).
/// Also writes a `.externs` sidecar file listing the extern crate names for
/// transitive dependency computation.
async fn write_outputs_to_cargo(
	tg: &impl tg::Handle,
	build_dir: &tg::Directory,
	output_directory: &PathBuf,
	externs: &[(String, String)],
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

	// Write .externs sidecar file for transitive dependency computation.
	// Find the rlib in the build dir to get the filename prefix.
	for (filename, _) in &entries {
		let path = std::path::Path::new(filename);
		if path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("rlib")) {
			let externs_filename = path.with_extension("externs");
			let externs_path = output_directory.join(externs_filename.file_name().unwrap());
			let extern_names: Vec<&str> = externs.iter().map(|(name, _)| name.as_str()).collect();
			let content = extern_names.join("\n");
			tokio::fs::write(&externs_path, content).await.map_err(|error| {
				tg::error!(
					source = error,
					"failed to write externs file {}",
					externs_path.display()
				)
			})?;
			break; // Only need one .externs file per crate.
		}
	}

	let futures = entries.into_iter().map(|(filename, artifact)| {
		let output_directory = output_directory.clone();
		async move {
			let to = output_directory.join(&filename);

			// Remove existing file/symlink if present.
			if to.exists() || to.is_symlink() {
				tokio::fs::remove_file(&to).await.ok();
			}

			// Symlink all outputs to the artifact store.
			symlink_artifact(tg, &artifact, &to).await?;

			// For binaries with a metadata suffix (e.g., `foo_bar-abc123`), cargo expects
			// a convenience symlink with hyphens and no suffix (e.g., `foo-bar`).
			let ext = std::path::Path::new(&filename).extension();
			if ext.is_none()
				&& let Some(convenience_name) = strip_metadata_suffix(&filename)
			{
				let convenience_path = output_directory.join(&convenience_name);
				if convenience_path.exists() || convenience_path.is_symlink() {
					tokio::fs::remove_file(&convenience_path).await.ok();
				}
				symlink_artifact(tg, &artifact, &convenience_path).await?;
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
// These either:
// - Are used only by the outer proxy (not the inner driver)
// - Vary per outer build and would pollute the inner process's cache key
const BLACKLISTED_ENV_VARS: [&str; 15] = [
	// Proxy-specific vars (used by outer proxy, not inner driver).
	"TGRUSTC_TRACING",
	"TGRUSTC_WORKSPACE_SOURCE",
	"TGRUSTC_DRIVER_EXECUTABLE",
	"TGRUSTC_STATS_FILE",
	// Tangram vars.
	"TANGRAM_HOST",
	"TANGRAM_URL",
	"TANGRAM_OUTPUT",
	"TANGRAM_PROCESS",
	// Build-specific paths that vary per cargo invocation.
	// These are safe to remove because rustc gets explicit --out-dir and current_dir.
	"HOME",
	"PWD",
	"TARGET_DIR",
	"SOURCE",
	// CARGO_HOME is cargo-specific; rustc doesn't use it.
	"CARGO_HOME",
	// CARGO_MANIFEST_DIR/PATH contain workspace root which varies.
	// Rustc doesn't need these; we set current_dir to the crate source.
	"CARGO_MANIFEST_DIR",
	"CARGO_MANIFEST_PATH",
];

/// Extract an artifact from a rendered path containing "/.tangram/artifacts/".
/// Returns the artifact and optional subpath. Navigates into directories if there is a subpath.
async fn extract_artifact_from_path(
	tg: &impl tg::Handle,
	path: &str,
) -> tg::Result<(tg::Artifact, Option<String>)> {
	let template = tangram_std::unrender(path)?;
	let mut components = template.components.into_iter();

	let artifact = components
		.next()
		.and_then(|c| c.try_unwrap_artifact().ok())
		.ok_or_else(|| tg::error!("expected artifact in path: {path}"))?;

	if let Some(component) = components.next() {
		let subpath = component
			.try_unwrap_string()
			.map_err(|_| tg::error!("expected string subpath in path: {path}"))?;
		let subpath = subpath.trim_start_matches('/');

		if subpath.is_empty() {
			return Ok((artifact, None));
		}

		let dir = artifact
			.try_unwrap_directory()
			.map_err(|_| tg::error!("expected directory for subpath in: {path}"))?;
		let inner = dir.get(tg, subpath).await?;
		Ok((inner, Some(subpath.trim_end_matches('/').to_owned())))
	} else {
		Ok((artifact, None))
	}
}

/// Resolve a path to an artifact. Extracts from artifact paths or checks in regular paths.
async fn resolve_path_to_artifact(
	tg: &impl tg::Handle,
	target_path: &str,
) -> tg::Result<tg::Artifact> {
	if target_path.contains("/.tangram/artifacts/") {
		let (artifact, _) = extract_artifact_from_path(tg, target_path).await?;
		Ok(artifact)
	} else {
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

/// Check in a path and return it wrapped as a template Value.
async fn checkin_path(tg: &impl tg::Handle, path: &str) -> tg::Result<tg::Value> {
	if path == "." {
		return Ok(".".into());
	}
	let artifact = tg::checkin(
		tg,
		tg::checkin::Arg {
			options: tg::checkin::Options {
				deterministic: true,
				ignore: false,
				lock: None,
				..Default::default()
			},
			path: path.into(),
			updates: vec![],
		},
	)
	.await?;
	Ok(tangram_std::template_from_artifact(artifact).into())
}

/// Write a stats line to the stats file in JSONL format.
/// Uses append mode for concurrent safety with multiple rustc invocations.
#[cfg(feature = "tracing")]
fn write_stats_line(path: &str, stats: &RustcStats) -> tg::Result<()> {
	use std::io::Write;

	let mut line = serde_json::to_vec(stats)
		.map_err(|e| tg::error!("failed to serialize stats: {e}"))?;
	line.push(b'\n');

	let mut file = std::fs::OpenOptions::new()
		.create(true)
		.append(true)
		.open(path)
		.map_err(|e| tg::error!("failed to open stats file {path}: {e}"))?;

	file.write_all(&line)
		.map_err(|e| tg::error!("failed to write stats to {path}: {e}"))?;

	Ok(())
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
