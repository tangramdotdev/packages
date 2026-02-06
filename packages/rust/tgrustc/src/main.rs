use futures::TryStreamExt as _;
use std::{
	collections::BTreeMap,
	os::unix::{fs::PermissionsExt, process::CommandExt},
	path::{Path, PathBuf},
	pin::pin,
	str::FromStr,
};
use tangram_client::prelude::*;
use tangram_futures::stream::TryExt as _;
use tokio::io::AsyncWriteExt;

fn main() {
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

	tokio::runtime::Builder::new_current_thread()
		.enable_all()
		.build()
		.unwrap()
		.block_on(run_proxy(args))?;

	Ok(())
}

/// Input arguments to the rustc proxy.
#[derive(Debug)]
struct Args {
	/// Build script output directory, from `OUT_DIR`.
	cargo_out_directory: Option<String>,
	/// The crate being compiled, from `--crate-name`.
	crate_name: String,
	/// Paths from `-L dependency=` args.
	dependencies: Vec<String>,
	/// Extern crate entries from `--extern name=path` args.
	externs: Vec<(String, String)>,
	/// All other rustc arguments not handled above.
	remaining: Vec<String>,
	/// Path to the real rustc binary.
	rustc: String,
	/// Output directory from `--out-dir`.
	rustc_output_directory: Option<String>,
	/// The crate's manifest directory, from `CARGO_MANIFEST_DIR` or inferred from source file paths.
	source_directory: String,
	/// Whether cargo is piping source via stdin.
	stdin: bool,
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
			cargo_out_directory,
			crate_name: crate_name.unwrap_or_else(|| "unknown".into()),
			dependencies,
			externs,
			remaining,
			rustc,
			rustc_output_directory,
			source_directory,
			stdin,
		})
	}
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
		.env("OUT_DIR", &out_dir_source)
		.arg("--out-dir")
		.arg(&build_path)
		.exec();

	// If we get here, exec failed - write error to file since stderr is redirected.
	let _ = std::fs::write(
		format!("{tangram_output}/exec_error.txt"),
		format!("exec failed: {error}"),
	);

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

	// Resolve the three initial artifacts concurrently: source directory, OUT_DIR, and
	// driver executable. These are independent operations that each involve HTTP round-trips,
	// so parallelizing them saves ~1 round-trip latency.
	let source_future = async {
		let manifest_dir = &args.source_directory;

		if manifest_dir.contains("/.tangram/artifacts/") {
			// Fast path: extract artifact from the already-rendered path.
			let (artifact, subpath) = extract_artifact_from_path(tg, manifest_dir).await?;
			#[cfg(feature = "tracing")]
			tracing::info!(id = ?artifact.id(), ?subpath, "resolved crate source from artifact path");
			Ok::<_, tg::Error>((
				tangram_std::template_from_artifact(artifact).into(),
				subpath,
			))
		} else {
			// Check in the manifest directory to get a crate-specific artifact.
			// This is content-addressed, so unchanged crates get the same artifact ID.
			//
			// We also need to extract the crate's relative path within the workspace so we can
			// rewrite source file paths correctly. Cargo passes source files with workspace-relative
			// paths (e.g., "packages/greeting/src/lib.rs"), but we need to rewrite them to be
			// crate-relative (e.g., "src/lib.rs") since we set current_dir to the crate directory.
			//
			// We extract the subpath by checking if manifest_dir ends with a prefix that matches
			// the source file path structure.
			let subpath = args.remaining.iter().find_map(|arg| {
				// Find a .rs file argument that looks like a workspace-relative path.
				let path = Path::new(arg);
				if path
					.extension()
					.is_some_and(|ext| ext.eq_ignore_ascii_case("rs"))
					&& !arg.starts_with('-')
					&& !arg.starts_with('/')
					&& !arg.contains("/.tangram/")
				{
					// Check if this is a workspace-relative path (contains directory separator).
					// Extract the prefix before /src/ for files under src/, or the parent
					// directory for files at the crate root (like build.rs).
					if let Some(src_pos) = arg.find("/src/") {
						let prefix = &arg[..src_pos];
						// Verify manifest_dir ends with this prefix.
						if manifest_dir.ends_with(prefix) {
							return Some(prefix.to_owned());
						}
					} else if let Some(parent) = path.parent()
						&& !parent.as_os_str().is_empty()
					{
						// Handle files at the crate root (e.g., build.rs at packages/compiler/build.rs).
						// The parent would be "packages/compiler".
						let prefix = parent.to_str()?;
						if manifest_dir.ends_with(prefix) {
							return Some(prefix.to_owned());
						}
					}
				}
				None
			});

			#[cfg(feature = "tracing")]
			tracing::info!(
				?manifest_dir,
				?subpath,
				"checking in crate source directory"
			);
			Ok((content_address_path(tg, manifest_dir).await?, subpath))
		}
	};

	// Check in the cargo out directory (used for build script outputs like cc-rs compiled libs).
	// The artifact is passed as TGRUSTC_OUT_DIR to the inner driver.
	//
	// Before checking in, normalize ar archives to remove non-deterministic header
	// fields (timestamps, uid, gid). This ensures identical source + build script
	// inputs produce identical OUT_DIR artifacts across builds.
	let out_dir_future = async {
		#[cfg(feature = "tracing")]
		let _span = tracing::info_span!("checkin_out_dir").entered();

		if let Some(path) = &args.cargo_out_directory {
			let out_dir_path = std::path::PathBuf::from_str(path)
				.map_err(|source| tg::error!(!source, %path,  "unable to construct path"))?;

			// Normalize ar archives to make the content deterministic.
			if let Err(_e) = normalize_ar_archives(&out_dir_path) {
				#[cfg(feature = "tracing")]
				tracing::warn!(?out_dir_path, error = %_e, "failed to normalize ar archives in OUT_DIR");
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
					path: out_dir_path.clone(),
					updates: vec![],
				},
			)
			.await?;

			#[cfg(feature = "tracing")]
			tracing::info!(?path, artifact_id = ?artifact.id(), "checked in OUT_DIR");

			Ok::<_, tg::Error>(tangram_std::template_from_artifact(artifact).into())
		} else {
			// Create an empty directory, store it, and wrap it in a template so it renders as a path.
			let empty_dir = tg::Directory::with_entries(BTreeMap::new());
			empty_dir.store(tg).await?;
			Ok(tangram_std::template_from_artifact(empty_dir.into()).into())
		}
	};

	// Get the driver executable (tgrustc itself).
	let executable_future = async {
		if let Ok(path) = std::env::var("TGRUSTC_DRIVER_EXECUTABLE") {
			let (artifact, _) = extract_artifact_from_path(tg, &path).await?;
			Ok::<_, tg::Error>(
				artifact
					.try_unwrap_file()
					.map_err(|_| tg::error!("expected file in TGRUSTC_DRIVER_EXECUTABLE"))?
					.into(),
			)
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
			Ok(artifact
				.try_unwrap_file()
				.map_err(|_| tg::error!("expected file from tgrustc checkin"))?
				.into())
		}
	};

	let ((source_directory, crate_subpath), out_dir, executable): (
		(tg::Value, Option<String>),
		tg::Value,
		tg::command::Executable,
	) = futures::future::try_join3(source_future, out_dir_future, executable_future).await?;

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
			filter_path_var(&value, &["/usr/lib", "/usr/local/lib", "/lib"])
		} else if name == "PATH" {
			filter_path_var(
				&value,
				&["/usr/bin", "/usr/local/bin", "/bin", "/sbin", "/usr/sbin"],
			)
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
		// Handle native= args specially - prepend the prefix to the content-addressed path.
		if let Some(native_path) = arg.strip_prefix("native=") {
			// Content-address the native path.
			let path_value = content_address_path(tg, native_path).await?;
			// Extract components from the value and prepend "native=".
			let template = match path_value {
				tg::Value::Template(t) => {
					let mut components = vec!["native=".to_owned().into()];
					components.extend(t.components);
					tg::Template { components }
				},
				tg::Value::String(s) => tg::Template {
					components: vec![format!("native={s}").into()],
				},
				_ => {
					return Err(tg::error!(
						"unexpected value type for native path: {native_path}"
					));
				},
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

		// Fast path: non-path args do not need content-addressing.
		if !arg.starts_with('/') && !arg.contains("/.tangram/") {
			command_args.push(arg.clone().into());
			continue;
		}

		// Content-address absolute or artifact paths for cache stability.
		let value = content_address_path(tg, arg).await?;
		command_args.push(value);
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
			process_dependencies(tg, &args.dependencies, &args.externs, &args.crate_name),
		)
		.await?
	};
	command_args.extend(extern_args);
	command_args.extend(dep_args);

	// Create the process.
	let host = host().to_string();
	#[cfg(feature = "tracing")]
	tracing::info!(?host, "creating inner process");

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

		// Use wait() instead of output() to get access to the output even for failed processes.
		let wait = process.wait(tg, tg::process::wait::Arg::default()).await?;

		if wait.exit != 0 {
			// Process failed. Try to get stderr from the output to show the actual error.
			let stderr_bytes: Option<Vec<u8>> = async {
				let output_obj = wait.output.as_ref()?.clone().try_unwrap_object().ok()?;
				let output_dir = output_obj.try_unwrap_directory().ok()?;
				let stderr_file = output_dir
					.get(tg, "log/stderr")
					.await
					.ok()?
					.try_unwrap_file()
					.ok()?;
				let bytes = stderr_file.contents(tg).await.ok()?.bytes(tg).await.ok()?;
				Some(bytes)
			}
			.await;
			if let Some(bytes) = stderr_bytes.filter(|b| !b.is_empty()) {
				let stderr_str = String::from_utf8_lossy(&bytes);
				eprintln!(
					"Inner process stderr for crate '{}':\n{}",
					args.crate_name, stderr_str
				);
			}
			eprintln!(
				"Inner process failed for crate '{}'. View logs with: tangram log {process_id}",
				args.crate_name
			);
			#[cfg(feature = "tracing")]
			{
				let exit = wait.exit;
				tracing::error!(?exit, ?process_id, "inner process error details");
			}
			return Err(tg::error!("the process exited with code {}", wait.exit));
		}

		wait.output.unwrap_or(tg::Value::Null)
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

	// Get stdout, stderr, and build directory from the output concurrently.
	// These are independent reads on the same immutable output directory.
	let (stdout, stderr, build_dir) = futures::future::try_join3(
		async {
			output
				.get(tg, &"log/stdout")
				.await?
				.try_unwrap_file()
				.unwrap()
				.contents(tg)
				.await?
				.bytes(tg)
				.await
		},
		async {
			output
				.get(tg, &"log/stderr")
				.await?
				.try_unwrap_file()
				.unwrap()
				.contents(tg)
				.await?
				.bytes(tg)
				.await
		},
		async {
			let dir = output
				.get(tg, "build")
				.await?
				.try_unwrap_directory()
				.map_err(|_| {
					tg::error!("expected 'build' directory in output from process {process_id}")
				})?;
			#[cfg(feature = "tracing")]
			{
				let build_dir_id = dir.id();
				tracing::info!(?build_dir_id, "got build directory");
			}
			Ok::<_, tg::Error>(dir)
		},
	)
	.await?;

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
			command_id = %command_id,
			"proxy_complete"
		);
	}

	Ok(())
}

// Environment variables that must be filtered out before invoking the driver target.
// These either:
// - Are used only by the outer proxy (not the inner driver)
// - Vary per outer build and would pollute the inner process's cache key
const BLACKLISTED_ENV_VARS: [&str; 17] = [
	// Proxy-specific vars (used by outer proxy, not inner driver).
	"TGRUSTC_TRACING",
	"TGRUSTC_DRIVER_EXECUTABLE",
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
	"CARGO_TARGET_DIR",
	"SOURCE",
	// OUT_DIR is a temp path that varies per build. We check it in and pass the
	// content-addressed artifact via TGRUSTC_OUT_DIR instead. The driver then
	// sets OUT_DIR for rustc from TGRUSTC_OUT_DIR.
	"OUT_DIR",
	// Language-specific path vars that rustc doesn't need.
	"NODE_PATH",
	"PYTHONPATH",
	// CARGO_HOME is cargo-specific; rustc doesn't use it.
	"CARGO_HOME",
	// CARGO_MANIFEST_DIR/PATH contain workspace root which varies.
	// Rustc doesn't need these; we set current_dir to the crate source.
	"CARGO_MANIFEST_DIR",
	"CARGO_MANIFEST_PATH",
];

/// Filter a colon-separated path variable, keeping only paths matching allowed prefixes
/// or containing `/.tangram/artifacts/`.
fn filter_path_var(value: &str, allowed_prefixes: &[&str]) -> String {
	value
		.split(':')
		.filter(|path| {
			allowed_prefixes
				.iter()
				.any(|prefix| path.starts_with(prefix))
				|| path.contains("/.tangram/artifacts/")
		})
		.collect::<Vec<_>>()
		.join(":")
}

/// Process extern crate dependencies into command args.
///
/// Creates symlinks to the file artifacts and uses them in --extern args.
/// Both the symlink and its target artifact are cached in a single batch call.
async fn process_externs(
	tg: &impl tg::Handle,
	externs: &[(String, String)],
) -> tg::Result<Vec<tg::Value>> {
	let mut sorted = externs.to_vec();
	sorted.sort_by(|a, b| a.0.cmp(&b.0));

	let futures = sorted.iter().map(|(name, path)| {
		let name = name.clone();
		let path = path.clone();
		async move {
			if path.is_empty() {
				return Ok((vec!["--extern".to_owned().into(), name.into()], Vec::new()));
			}

			let file_path = PathBuf::from(&path);

			let filename = file_path
				.file_name()
				.and_then(|s| s.to_str())
				.ok_or_else(|| tg::error!("extern path has no filename: {path}"))?
				.to_owned();

			let artifact = follow_and_resolve(tg, &path)
				.await?
				.try_unwrap_file()
				.map_err(|_| tg::error!("expected file for extern crate '{name}'"))?;

			// Put the file directly in a directory to preserve the filename.
			// When Tangram renders this, it creates a symlink to the file artifact.
			let wrapped =
				tg::Directory::with_entries([(filename.clone(), artifact.clone().into())].into());
			wrapped.store(tg).await?;

			// Collect IDs for batch caching instead of caching individually.
			let cache_ids = vec![artifact.id().into(), wrapped.id().into()];

			let template = tg::Template {
				components: vec![
					format!("{name}=").into(),
					wrapped.into(),
					format!("/{filename}").into(),
				],
			};
			Ok::<_, tg::Error>((
				vec!["--extern".to_owned().into(), template.into()],
				cache_ids,
			))
		}
	});

	let results: Vec<(Vec<tg::Value>, Vec<tg::artifact::Id>)> =
		futures::future::try_join_all(futures).await?;

	// Batch cache all artifact IDs in a single HTTP call.
	let all_cache_ids: Vec<tg::artifact::Id> =
		results.iter().flat_map(|(_, ids)| ids.clone()).collect();
	batch_cache(tg, all_cache_ids).await?;

	Ok(results.into_iter().flat_map(|(args, _)| args).collect())
}

/// Process dependency directories into a merged artifact directory.
async fn process_dependencies(
	tg: &impl tg::Handle,
	dependencies: &[String],
	externs: &[(String, String)],
	crate_name: &str,
) -> tg::Result<Vec<tg::Value>> {
	// Compute the transitive dependency closure (stem-based).
	let needed_stems = compute_transitive_closure(dependencies, externs, crate_name);

	// Collect files from dependency directories, filtered to needed stems.
	let mut files: Vec<(String, String)> = Vec::new();
	for dep in dependencies {
		let Ok(entries) = std::fs::read_dir(dep) else {
			continue;
		};
		for entry in entries.flatten() {
			let path = entry.path();
			let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
				continue;
			};
			// Skip .d and .externs files.
			let ext = path.extension();
			if ext.is_some_and(|e| e == "d" || e == "externs") {
				continue;
			}
			// Filter to crate versions in our transitive closure using stems.
			let Some(stem) = extract_stem(name) else {
				continue;
			};
			if !needed_stems.contains(stem) {
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

	// Resolve all files to artifacts without caching individually.
	let futures = files.iter().map(|(name, path)| {
		let name = name.clone();
		let path = path.clone();
		async move {
			let artifact = resolve_path_to_artifact(tg, &path).await.ok()?;
			Some((name, artifact))
		}
	});
	let entries: BTreeMap<String, tg::Artifact> = futures::future::join_all(futures)
		.await
		.into_iter()
		.flatten()
		.collect();

	if entries.is_empty() {
		return Ok(vec![]);
	}

	// Collect all artifact IDs for a single batch cache call.
	let mut all_cache_ids: Vec<tg::artifact::Id> = entries.values().map(tg::Artifact::id).collect();

	let merged = tg::Directory::with_entries(entries);
	merged.store(tg).await?;
	all_cache_ids.push(merged.id().into());

	// Batch cache all file artifacts and the merged directory in one call.
	batch_cache(tg, all_cache_ids).await?;
	let template = tg::Template {
		components: vec!["dependency=".to_owned().into(), merged.into()],
	};
	Ok(vec!["-L".to_owned().into(), template.into()])
}

/// Write build outputs to cargo's output directory.
///
/// Dependency files (.rlib, .rmeta, .d, .so, .dylib) are symlinked to the artifact
/// store for speed. Binaries are copied with explicit executable permissions (0o755)
/// to ensure proper execution on all platforms, particularly Linux which requires
/// the executable bit to be set.
///
/// For binaries with metadata suffixes, also creates convenience symlinks
/// (e.g., `build_script_build-abc123` gets a `build-script-build` symlink).
/// Also writes:
/// - `.externs` sidecar file listing extern crate names for transitive dependency computation
#[allow(clippy::too_many_lines)]
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
	// Find an rlib or rmeta in the build dir to get the filename prefix.
	for (filename, _) in &entries {
		let path = std::path::Path::new(filename);
		let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
		if ext.eq_ignore_ascii_case("rlib") || ext.eq_ignore_ascii_case("rmeta") {
			let externs_filename = path.with_extension("externs");
			let externs_path = output_directory.join(externs_filename.file_name().unwrap());
			let extern_stems: Vec<String> = externs
				.iter()
				.filter_map(|(_, path)| {
					std::path::Path::new(path)
						.file_name()
						.and_then(|s| s.to_str())
						.and_then(extract_stem)
						.map(ToOwned::to_owned)
				})
				.collect();
			let content = extern_stems.join("\n");
			tokio::fs::write(&externs_path, content)
				.await
				.map_err(|error| {
					tg::error!(
						source = error,
						"failed to write externs file {}",
						externs_path.display()
					)
				})?;
			break; // Only need one .externs file per crate.
		}
	}

	// Classify entries and collect artifact IDs for dependency files that need caching.
	let dep_artifact_ids: Vec<tg::artifact::Id> = entries
		.iter()
		.filter(|(filename, _)| is_dependency_file(filename))
		.map(|(_, artifact)| artifact.id())
		.collect();

	// Batch cache all dependency artifacts in a single HTTP call.
	batch_cache(tg, dep_artifact_ids).await?;

	// Now create symlinks and copy binaries concurrently.
	let futures = entries.into_iter().map(|(filename, artifact)| {
		let output_directory = output_directory.clone();
		async move {
			let to = output_directory.join(&filename);

			// Remove existing file/symlink if present.
			if to.exists() || to.is_symlink() {
				tokio::fs::remove_file(&to).await.ok();
			}

			if is_dependency_file(&filename) {
				// Symlink dependencies to the artifact store (already cached above).
				symlink_cached_artifact(&artifact, &to).await?;
			} else {
				// Copy binaries and set executable permissions.
				let file = artifact
					.try_unwrap_file()
					.map_err(|_| tg::error!("expected file artifact for {}", filename))?;
				let bytes = file.bytes(tg).await?;
				tokio::fs::write(&to, &bytes).await.map_err(|error| {
					tg::error!(source = error, "failed to write file {}", to.display())
				})?;
				// Make the file executable (required on Linux).
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

				// For binaries with a metadata suffix (e.g., `foo_bar-abc123`), cargo expects
				// a convenience symlink with hyphens and no suffix (e.g., `foo-bar`).
				if let Some(convenience_name) = strip_metadata_suffix(&filename) {
					let convenience_path = output_directory.join(&convenience_name);
					if convenience_path.exists() || convenience_path.is_symlink() {
						tokio::fs::remove_file(&convenience_path).await.ok();
					}
					// Create a symlink to the copied binary.
					tokio::fs::symlink(&to, &convenience_path)
						.await
						.map_err(|error| {
							tg::error!(
								source = error,
								"failed to create convenience symlink from {} to {}",
								convenience_path.display(),
								to.display()
							)
						})?;
				}
			}

			Ok::<_, tg::Error>(())
		}
	});

	futures::future::try_join_all(futures).await?;

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

/// Follow a symlink (if present) and resolve the target to an artifact.
async fn follow_and_resolve(
	tg: &impl tg::Handle,
	path: &str,
) -> tg::Result<tg::Artifact> {
	let file_path = PathBuf::from(path);
	let target = if file_path.is_symlink() {
		std::fs::read_link(&file_path)
			.ok()
			.and_then(|t| t.to_str().map(ToOwned::to_owned))
			.unwrap_or_else(|| path.to_owned())
	} else {
		path.to_owned()
	};
	resolve_path_to_artifact(tg, &target).await
}

/// Compute the transitive dependency closure starting from extern crates.
fn compute_transitive_closure(
	dependencies: &[String],
	externs: &[(String, String)],
	_crate_name: &str, // Currently unused but kept for debugging.
) -> std::collections::HashSet<String> {
	use std::collections::{HashMap, HashSet, VecDeque};

	// Build a map of stem -> deps (as stems) from .externs sidecar files.
	let mut externs_map: HashMap<String, HashSet<String>> = HashMap::new();
	for dep_dir in dependencies {
		let Ok(entries) = std::fs::read_dir(dep_dir) else {
			continue;
		};
		for entry in entries.flatten() {
			let path = entry.path();
			if path.extension().is_some_and(|ext| ext == "externs")
				&& let Some(stem) = path
					.file_name()
					.and_then(|s| s.to_str())
					.and_then(extract_stem)
				&& let Ok(content) = std::fs::read_to_string(&path)
			{
				let deps: HashSet<String> = content
					.lines()
					.map(|s| s.trim().to_owned())
					.filter(|s| !s.is_empty())
					.collect();
				externs_map.insert(stem.to_owned(), deps);
			}
		}
	}

	// BFS to compute transitive closure using stems.
	let mut closure: HashSet<String> = HashSet::new();
	let mut queue: VecDeque<String> = externs
		.iter()
		.filter_map(|(_, path)| {
			std::path::Path::new(path)
				.file_name()
				.and_then(|f| f.to_str())
				.and_then(extract_stem)
				.map(ToOwned::to_owned)
		})
		.collect();

	while let Some(stem) = queue.pop_front() {
		if !closure.insert(stem.clone()) {
			continue; // Already processed.
		}
		// Add this crate version's dependencies to the queue.
		if let Some(deps) = externs_map.get(&stem) {
			for dep_stem in deps {
				if !closure.contains(dep_stem) {
					queue.push_back(dep_stem.clone());
				}
			}
		}
	}

	#[cfg(feature = "tracing")]
	tracing::info!(
		crate_name = _crate_name,
		closure_size = closure.len(),
		"transitive_closure_computed"
	);

	closure
}

/// Check whether a filename has a dependency file extension (rlib, rmeta, d, so, dylib).
fn is_dependency_file(filename: &str) -> bool {
	Path::new(filename).extension().is_some_and(|ext| {
		matches!(
			ext.to_str(),
			Some("rlib" | "rmeta" | "d" | "so" | "dylib")
		)
	})
}

/// Strip the rustc metadata suffix from a filename and convert underscores to hyphens.
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

/// Create a symlink from `target` pointing to a pre-cached artifact in the local store.
async fn symlink_cached_artifact(artifact: &tg::Artifact, target: &Path) -> tg::Result<()> {
	let from = PathBuf::from(&*tangram_std::CLOSEST_ARTIFACT_PATH).join(artifact.id().to_string());
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

/// Extract the full stem (crate name + metadata hash) from a library filename.
fn extract_stem(filename: &str) -> Option<&str> {
	let rest = filename.strip_prefix("lib").unwrap_or(filename);
	// Strip the extension.
	let dot_pos = rest.rfind('.')?;
	Some(&rest[..dot_pos])
}

/// Batch cache a set of artifacts in a single HTTP call.
async fn batch_cache(tg: &impl tg::Handle, artifacts: Vec<tg::artifact::Id>) -> tg::Result<()> {
	if artifacts.is_empty() {
		return Ok(());
	}
	tg.cache(tg::cache::Arg { artifacts })
		.await
		.map_err(|e| tg::error!(source = e, "failed to cache artifacts"))?
		.try_collect::<Vec<_>>()
		.await
		.map_err(|e| tg::error!(source = e, "failed to cache artifacts"))?;
	Ok(())
}

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

/// Content-address a path, returning an artifact-based template value.
async fn content_address_path(tg: &impl tg::Handle, path: &str) -> tg::Result<tg::Value> {
	// First, try to unrender the path. This handles:
	let template = tangram_std::unrender(path)?;

	// Check if the template contains any artifacts. If so, use it.
	let has_artifacts = template
		.components
		.iter()
		.any(|c| matches!(c, tg::template::Component::Artifact(_)));

	if has_artifacts {
		#[cfg(feature = "tracing")]
		tracing::trace!(?path, "path contains artifacts, using unrender result");
		return Ok(template.into());
	}

	// The path doesn't contain artifacts. Check it in,
	let path_obj = Path::new(path);
	if path_obj.is_absolute() && path_obj.exists() {
		#[cfg(feature = "tracing")]
		tracing::trace!(?path, "content-addressing absolute path via checkin");

		let artifact = tg::checkin(
			tg,
			tg::checkin::Arg {
				options: tg::checkin::Options {
					destructive: false,
					deterministic: true,
					ignore: false,
					local_dependencies: false,
					solve: false,
					..Default::default()
				},
				path: path.into(),
				updates: vec![],
			},
		)
		.await?;

		return Ok(tangram_std::template_from_artifact(artifact).into());
	}

	// For relative paths or non-existent paths, return the unrendered template as-is.
	Ok(template.into())
}

/// Resolve a path to an artifact. Uses `content_address_path` internally.
async fn resolve_path_to_artifact(
	tg: &impl tg::Handle,
	target_path: &str,
) -> tg::Result<tg::Artifact> {
	let value = content_address_path(tg, target_path).await?;

	// Extract the artifact from the value.
	match value {
		tg::Value::Template(template) => template
			.components
			.into_iter()
			.find_map(|c| c.try_unwrap_artifact().ok())
			.ok_or_else(|| tg::error!("expected artifact in path: {target_path}")),
		tg::Value::Object(obj) => obj
			.try_into()
			.map_err(|_| tg::error!("expected artifact in path: {target_path}")),
		_ => Err(tg::error!("expected artifact in path: {target_path}")),
	}
}

/// Normalize ar archives in a directory to ensure deterministic content.
fn normalize_ar_archives(dir: &Path) -> tg::Result<()> {
	let entries = std::fs::read_dir(dir)
		.map_err(|e| tg::error!("failed to read directory {}: {e}", dir.display()))?;

	for entry in entries.flatten() {
		let path = entry.path();
		if path.extension().is_some_and(|ext| ext == "a") {
			normalize_ar_archive(&path)?;
		} else if entry.file_type().is_ok_and(|ft| ft.is_dir()) {
			normalize_ar_archives(&path)?;
		}
	}

	Ok(())
}

/// Normalize a single ar archive file by zeroing non-deterministic header fields.
///
/// The BSD/GNU ar format has member headers with the following layout (60 bytes total):
///   name:    16 bytes
///   mtime:   12 bytes (zeroed by this function)
///   uid:      6 bytes (zeroed by this function)
///   gid:      6 bytes (zeroed by this function)
///   mode:     8 bytes
///   size:    10 bytes
///   end:      2 bytes (backtick + `\n`)
fn normalize_ar_archive(path: &Path) -> tg::Result<()> {
	const AR_MAGIC: &[u8] = b"!<arch>\n";
	const AR_HEADER_SIZE: usize = 60;
	const MTIME_OFFSET: usize = 16;
	const MTIME_LEN: usize = 12;
	const UID_OFFSET: usize = 28;
	const UID_LEN: usize = 6;
	const GID_OFFSET: usize = 34;
	const GID_LEN: usize = 6;

	let mut data = std::fs::read(path)
		.map_err(|e| tg::error!("failed to read ar archive {}: {e}", path.display()))?;

	if data.len() < AR_MAGIC.len() || &data[..AR_MAGIC.len()] != AR_MAGIC {
		return Ok(());
	}

	let mut offset = AR_MAGIC.len();
	let mut modified = false;

	while offset + AR_HEADER_SIZE <= data.len() {
		if &data[offset + 58..offset + 60] != b"`\n" {
			break;
		}

		// Zero out modification time.
		let mtime_start = offset + MTIME_OFFSET;
		data[mtime_start..mtime_start + MTIME_LEN].copy_from_slice(b"0           ");

		// Zero out owner ID.
		let uid_start = offset + UID_OFFSET;
		data[uid_start..uid_start + UID_LEN].copy_from_slice(b"0     ");

		// Zero out group ID.
		let gid_start = offset + GID_OFFSET;
		data[gid_start..gid_start + GID_LEN].copy_from_slice(b"0     ");

		modified = true;

		// Parse file size to advance to the next member.
		let size_start = offset + 48;
		let size_end = offset + 58;
		let size_str = std::str::from_utf8(&data[size_start..size_end])
			.unwrap_or("")
			.trim();
		let size: usize = size_str.parse().unwrap_or(0);

		// Move past header + content (padded to even boundary).
		offset += AR_HEADER_SIZE + size;
		if !offset.is_multiple_of(2) {
			offset += 1;
		}
	}

	if modified {
		std::fs::write(path, &data).map_err(|e| {
			tg::error!(
				"failed to write normalized ar archive {}: {e}",
				path.display()
			)
		})?;

		#[cfg(feature = "tracing")]
		tracing::info!(?path, "normalized ar archive headers");
	}

	Ok(())
}
