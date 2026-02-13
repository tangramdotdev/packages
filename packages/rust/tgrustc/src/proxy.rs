use crate::{args::Args, driver::RUNNER_OUT_DIR_PLACEHOLDER, process};
use std::{
	collections::BTreeMap,
	os::unix::fs::PermissionsExt,
	path::{Path, PathBuf},
};
use tangram_client::prelude::*;

/// Run the proxy.
#[allow(clippy::too_many_lines)]
pub(crate) async fn run_proxy(args: Args) -> tg::Result<()> {
	#[cfg(feature = "tracing")]
	let start_time = std::time::Instant::now();
	// When cargo compiles a build script, it passes `--crate-name build_script_build`
	// for all build scripts regardless of which crate they belong to. Use CARGO_PKG_NAME
	// to produce a more descriptive display name for process naming and tracing.
	let display_name = if args.crate_name == "build_script_build" {
		if let Ok(pkg) = std::env::var("CARGO_PKG_NAME") {
			// Normalize hyphens to underscores to match cargo's --crate-name convention.
			format!("build_script_build({})", pkg.replace('-', "_"))
		} else {
			args.crate_name.clone()
		}
	} else {
		args.crate_name.clone()
	};

	#[cfg(feature = "tracing")]
	let _span = tracing::info_span!("rustc_proxy", crate = %display_name).entered();

	// Create a client.
	let tg = tg::Client::with_env()?;
	let tg = &tg;

	// Resolve the three initial artifacts concurrently: source directory, OUT_DIR, and driver executable.
	let source_future = async {
		let manifest_dir = &args.source_directory;

		if manifest_dir.contains("/.tangram/artifacts/") {
			// Fast path: extract artifact from the already-rendered path.
			let (artifact, subpath) = process::extract_artifact_from_path(tg, manifest_dir).await?;
			#[cfg(feature = "tracing")]
			tracing::info!(id = ?artifact.id(), ?subpath, "resolved crate source from artifact path");
			Ok::<_, tg::Error>((
				tangram_std::template_from_artifact(artifact).into(),
				subpath,
			))
		} else {
			// Check in the manifest directory to get a crate-specific artifact.
			#[cfg(feature = "tracing")]
			tracing::info!(?manifest_dir, "checking in crate source directory");
			Ok((process::content_address_path(tg, manifest_dir).await?, None))
		}
	};

	// Check in the cargo out directory (used for build script outputs like cc-rs compiled libs).
	// The artifact is passed as TGRUSTC_OUT_DIR to the inner driver.
	let out_dir_future = async {
		#[cfg(feature = "tracing")]
		let _span = tracing::info_span!("checkin_out_dir").entered();

		if let Some(path) = &args.cargo_out_directory {
			let out_dir_path = PathBuf::from(path);

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

	let ((source_directory, crate_subpath), out_dir, executable): (
		(tg::Value, Option<String>),
		tg::Value,
		tg::command::Executable,
	) = futures::future::try_join3(
		source_future,
		out_dir_future,
		process::resolve_executable(tg),
	)
	.await?;

	// Unrender the environment.
	let mut env = BTreeMap::new();
	for (name, value) in
		std::env::vars().filter(|(name, _)| !BLACKLISTED_ENV_VARS.contains(&name.as_str()))
	{
		let value = tangram_std::unrender(&value)?;
		env.insert(name, value.into());
	}

	// Set up driver mode environment variables.
	// These tell the inner tgrustc (running in driver mode) where things are.
	let rustc_template = tangram_std::unrender(&args.rustc)?;
	env.insert("TGRUSTC_DRIVER_MODE".to_owned(), "1".to_owned().into());
	env.insert("TGRUSTC_RUSTC".to_owned(), rustc_template.into());
	env.insert("TGRUSTC_SOURCE".to_owned(), source_directory.clone());
	env.insert("TGRUSTC_OUT_DIR".to_owned(), out_dir.clone());
	// Set CARGO_MANIFEST_DIR for proc-macros that read Cargo.toml.
	env.insert("CARGO_MANIFEST_DIR".to_owned(), source_directory.clone());
	#[cfg(feature = "tracing")]
	tracing::info!(?source_directory, "source_directory value for inner build");

	// Build command arguments - these are passed directly to rustc by the driver.
	// Tangram sets argv[0] from the executable, so we only pass the actual arguments.
	//
	// Two-pass approach: first pass identifies args that need content-addressing and
	// pushes None placeholders. Second pass resolves all pending paths concurrently.
	let mut command_args: Vec<Option<tg::Value>> = vec![];
	let mut pending: Vec<(usize, String, bool)> = vec![]; // (index, path, is_native)

	// Add remaining args (rustc flags, source files, etc).
	let mut remaining_iter = args.remaining.iter();
	while let Some(arg) = remaining_iter.next() {
		// Handle --remap-path-prefix and its value together. The workspace root path
		// changes when ANY file in the workspace is modified, even if the crate being
		// compiled is unchanged. Replace the workspace root in the remap with the
		// crate-specific source directory to make the command_id deterministic.
		if arg == "--remap-path-prefix"
			&& let Some(remap_value) = remaining_iter.next()
		{
			command_args.push(Some("--remap-path-prefix".to_owned().into()));
			if let Some((old, new)) = remap_value.split_once('=') {
				if args.source_directory.starts_with(old) {
					// Workspace remap: use the crate-specific source directory.
					let mut components: Vec<tg::template::Component> = match &source_directory {
						tg::Value::Template(t) => t.components.clone(),
						_ => unreachable!("source_directory is always a template"),
					};
					components.push(format!("={new}").into());
					command_args.push(Some(tg::Template { components }.into()));
				} else {
					// Non-workspace remap: pass through as-is.
					command_args.push(Some(remap_value.clone().into()));
				}
			} else {
				command_args.push(Some(remap_value.clone().into()));
			}
			continue;
		}

		// Handle native= args: push placeholder, resolve concurrently later.
		if let Some(native_path) = arg.strip_prefix("native=") {
			let idx = command_args.len();
			command_args.push(None);
			pending.push((idx, native_path.to_owned(), true));
			continue;
		}

		// Rewrite workspace-relative source file paths to crate-relative paths.
		// Cargo passes paths like "packages/greeting/src/lib.rs" (relative to
		// the workspace root), but the inner driver sets current_dir to the crate
		// directory, so we need "src/lib.rs" instead.
		if let Some(ref subpath) = crate_subpath {
			let is_source_file = std::path::Path::new(arg)
				.extension()
				.is_some_and(|ext| ext.eq_ignore_ascii_case("rs"))
				&& !arg.starts_with('-');
			if is_source_file {
				let stripped = arg.strip_prefix(subpath).map(|s| s.trim_start_matches('/'));
				if let Some(relative_path) = stripped {
					#[cfg(feature = "tracing")]
					tracing::info!(
						original = %arg,
						rewritten = %relative_path,
						"rewrote source file path to be crate-relative"
					);
					command_args.push(Some(relative_path.to_owned().into()));
					continue;
				}
			}
		}

		// Fast path: non-path args do not need content-addressing.
		if !arg.starts_with('/') && !arg.contains("/.tangram/") {
			command_args.push(Some(arg.clone().into()));
			continue;
		}

		// Absolute or artifact path: push placeholder, resolve concurrently later.
		let idx = command_args.len();
		command_args.push(None);
		pending.push((idx, arg.clone(), false));
	}

	// Resolve all pending content-address operations concurrently.
	if !pending.is_empty() {
		let resolve_futures = pending.iter().map(|(_, path, _)| {
			let path = path.clone();
			async move { process::content_address_path(tg, &path).await }
		});
		let resolved: Vec<tg::Value> =
			futures::future::try_join_all(resolve_futures).await?;
		for ((idx, _, is_native), value) in pending.iter().zip(resolved) {
			let final_value = if *is_native {
				// Prepend "native=" to the content-addressed path.
				match value {
					tg::Value::Template(t) => {
						let mut components = vec!["native=".to_owned().into()];
						components.extend(t.components);
						tg::Template { components }.into()
					},
					_ => unreachable!("content_address_path always returns a template"),
				}
			} else {
				value
			};
			command_args[*idx] = Some(final_value);
		}
	}

	// Unwrap all placeholders into the final arg vec.
	let mut command_args: Vec<tg::Value> = command_args.into_iter().map(|v| v.unwrap()).collect();

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
	let host = crate::host().to_string();
	#[cfg(feature = "tracing")]
	tracing::info!(?host, "creating inner process");

	// Build a command for the process.
	let command = tg::Command::builder(host, executable)
		.args(command_args)
		.env(env)
		.build();
	let command_id = command.store(tg).await?;
	let mut command_ref = tg::Referent::with_item(command_id.clone());
	command_ref
		.options
		.name
		.replace(format!("rustc {display_name}"));

	// Spawn and wait for the inner process.
	let description = format!("Inner process for crate '{display_name}'");
	let result = process::spawn_and_wait(tg, command_ref, &description).await?;

	#[cfg(feature = "tracing")]
	{
		let output_id = result.output.id();
		tracing::info!(?output_id, cached = result.cached, "got output");
	}

	// Get build directory and logs from the output concurrently.
	let ((stdout, stderr), build_dir) =
		futures::future::try_join(process::read_logs(tg, &result.output), async {
			let dir = result
				.output
				.get(tg, "build")
				.await?
				.try_unwrap_directory()
				.map_err(|_| {
					tg::error!(
						"expected 'build' directory in output from process {}",
						result.process_id
					)
				})?;
			#[cfg(feature = "tracing")]
			{
				let build_dir_id = dir.id();
				tracing::info!(?build_dir_id, "got build directory");
			}
			Ok::<_, tg::Error>(dir)
		})
		.await?;

	// Write outputs to cargo's output directory.
	{
		#[cfg(feature = "tracing")]
		let _span = tracing::info_span!("write_outputs").entered();

		let output_directory = PathBuf::from(
			args.rustc_output_directory
				.as_deref()
				.ok_or_else(|| tg::error!("expected --out-dir argument from cargo"))?,
		);
		write_outputs_to_cargo(tg, &build_dir, &output_directory, &args.externs).await?;
	}

	// Now that symlinks are created, forward stdout/stderr.
	// Cargo watches for JSON output indicating the .rmeta file is ready.
	process::forward_logs(&stdout, &stderr).await?;

	#[cfg(feature = "tracing")]
	{
		let elapsed = start_time.elapsed();
		let source_debug = format!("{source_directory:?}");
		let out_dir_debug = format!("{out_dir:?}");
		tracing::info!(
			crate_name = %display_name,
			elapsed_ms = elapsed.as_millis(),
			cached = result.cached,
			process_id = %result.process_id,
			command_id = %command_id,
			source = %source_debug,
			out_dir = %out_dir_debug,
			"proxy_complete"
		);
	}

	Ok(())
}

/// Run the runner (outer half): content-address inputs, spawn a Tangram process
/// for build script execution, then write outputs back to cargo's `OUT_DIR`.
#[allow(clippy::too_many_lines)]
pub(crate) async fn run_runner() -> tg::Result<()> {
	#[cfg(feature = "tracing")]
	let start_time = std::time::Instant::now();

	// The build script binary is argv[2] (argv[0]=tgrustc, argv[1]="runner").
	let script_binary = std::env::args()
		.nth(2)
		.ok_or_else(|| tg::error!("expected build script binary path after 'runner'"))?;

	let crate_name = std::env::var("CARGO_PKG_NAME").unwrap_or_else(|_| "unknown".into());

	#[cfg(feature = "tracing")]
	let _span = tracing::info_span!("runner", crate = %crate_name, binary = %script_binary).entered();

	// Create a client.
	let tg = tg::Client::with_env()?;
	let tg = &tg;

	// Content-address the three inputs concurrently.
	let script_future = async {
		// Read the (signed) binary and create a file artifact with executable flag.
		let contents = tokio::fs::read(&script_binary)
			.await
			.map_err(|e| tg::error!("failed to read build script binary: {e}"))?;
		let blob = tg::Blob::with_reader(tg, std::io::Cursor::new(contents)).await?;
		let file = tg::File::builder(blob).executable(true).build();
		let artifact: tg::Artifact = file.into();
		Ok::<_, tg::Error>(tangram_std::template_from_artifact(artifact).into())
	};

	let source_future = async {
		let manifest_dir = crate::required_env("CARGO_MANIFEST_DIR")?;

		// Check if CARGO_MANIFEST_DIR is a subdirectory of SOURCE (workspace member).
		let subpath = std::env::var("SOURCE").ok().and_then(|source| {
			Path::new(&manifest_dir)
				.strip_prefix(&source)
				.ok()
				.map(|p| p.to_string_lossy().to_string())
				.filter(|s| !s.is_empty())
		});

		if let Some(ref subpath) = subpath {
			// Workspace member: create a filtered workspace that includes the current
			// crate's full content but replaces other members' directories with stubs
			// (just Cargo.toml). This makes the runner's command_id independent of
			// changes to other members' source files, preventing cache miss cascades
			// for non-deterministic build scripts.
			let source_dir = std::env::var("SOURCE").unwrap();
			let source_value = create_filtered_workspace(tg, &source_dir, subpath).await?;
			Ok::<_, tg::Error>((source_value, subpath.clone()))
		} else {
			// Non-workspace crate: check in just the crate directory.
			let ca_value = process::content_address_path(tg, &manifest_dir).await?;
			Ok::<_, tg::Error>((ca_value, String::new()))
		}
	};

	let (script_value, (source_value, manifest_subpath), executable): (
		tg::Value,
		(tg::Value, String),
		tg::command::Executable,
	) = futures::future::try_join3(
		script_future,
		source_future,
		process::resolve_executable(tg),
	)
	.await?;

	// Unrender the environment. For PATH, we use unrender directly on the full
	// colon-separated string, which converts artifact references to templates while
	// preserving system path entries (like /usr/bin, /bin) as literal strings.
	// System paths in PATH become harmless dead entries in the sandbox since
	// all tools are provided as wrapped artifacts.
	//
	// Content-address all non-PATH env vars concurrently to avoid sequential I/O.
	let mut env = BTreeMap::new();
	let mut env_pending: Vec<(String, String)> = Vec::new();
	for (name, value) in
		std::env::vars().filter(|(name, _)| !RUNNER_BLACKLISTED_ENV_VARS.contains(&name.as_str()))
	{
		if name == "PATH" {
			env.insert(name, tangram_std::unrender(&value)?.into());
		} else {
			env_pending.push((name, value));
		}
	}
	if !env_pending.is_empty() {
		let env_futures = env_pending.iter().map(|(_, value)| {
			let value = value.clone();
			async move { process::content_address_path(tg, &value).await }
		});
		let resolved: Vec<tg::Value> =
			futures::future::try_join_all(env_futures).await?;
		for ((name, _), value) in env_pending.into_iter().zip(resolved) {
			env.insert(name, value);
		}
	}

	// Set runner driver mode environment variables.
	env.insert(
		"TGRUSTC_RUNNER_DRIVER_MODE".to_owned(),
		"1".to_owned().into(),
	);
	env.insert("TGRUSTC_RUNNER_SOURCE".to_owned(), source_value);
	if !manifest_subpath.is_empty() {
		env.insert(
			"TGRUSTC_RUNNER_MANIFEST_SUBPATH".to_owned(),
			manifest_subpath.into(),
		);
	}

	// Build the command: executable is tgrustc (self-as-driver), arg is the build script binary.
	let command_args: Vec<tg::Value> = vec![script_value];

	let host_str = crate::host().to_string();
	let command = tg::Command::builder(host_str, executable)
		.args(command_args)
		.env(env)
		.build();
	let command_id = command.store(tg).await?;
	let mut command_ref = tg::Referent::with_item(command_id.clone());
	command_ref
		.options
		.name
		.replace(format!("build-script {crate_name}"));

	// Spawn and wait for the runner process.
	let description = format!("Runner process for crate '{crate_name}'");
	let result = process::spawn_and_wait(tg, command_ref, &description).await?;

	// Read logs and out_dir from the output concurrently.
	let ((stdout, stderr), out_dir) =
		futures::future::try_join(process::read_logs(tg, &result.output), async {
			result
				.output
				.get(tg, RUNNER_OUT_DIR_PLACEHOLDER)
				.await?
				.try_unwrap_directory()
				.map_err(|_| {
					tg::error!(
						"expected '{RUNNER_OUT_DIR_PLACEHOLDER}' directory in output from runner process {}",
						result.process_id
					)
				})
		})
		.await?;

	// Write OUT_DIR contents to cargo's OUT_DIR path.
	let cargo_out_dir = crate::required_env("OUT_DIR")?;
	write_out_dir_to_cargo(tg, &out_dir, &PathBuf::from(&cargo_out_dir)).await?;

	// Replay stdout, replacing the OUT_DIR placeholder with cargo's actual path.
	// The inner runner driver replaces sandbox paths with this placeholder so the
	// cached process output is reusable across builds. See `run_runner_driver`.
	let stdout = {
		let text = String::from_utf8_lossy(&stdout);
		text.replace(RUNNER_OUT_DIR_PLACEHOLDER, &cargo_out_dir)
			.into_bytes()
	};
	process::forward_logs(&stdout, &stderr).await?;

	#[cfg(feature = "tracing")]
	{
		let elapsed = start_time.elapsed();
		let stdout_str = String::from_utf8_lossy(&stdout);
		let stdout_lines: Vec<&str> = stdout_str.lines().collect();
		tracing::info!(
			crate_name = %crate_name,
			elapsed_ms = elapsed.as_millis(),
			cached = result.cached,
			process_id = %result.process_id,
			command_id = %command_id,
			stdout_bytes = stdout.len(),
			stdout_lines = stdout_lines.len(),
			"runner_complete"
		);
		if stdout.is_empty() {
			tracing::warn!(
				crate_name = %crate_name,
				process_id = %result.process_id,
				cached = result.cached,
				"runner produced empty stdout, build script directives may be missing"
			);
		}
	}

	Ok(())
}

/// Write the contents of a runner output directory to cargo's `OUT_DIR` path.
async fn write_out_dir_to_cargo(
	tg: &impl tg::Handle,
	out_dir: &tg::Directory,
	target_path: &Path,
) -> tg::Result<()> {
	// Create the target directory if it does not exist.
	if !target_path.exists() {
		tokio::fs::create_dir_all(target_path)
			.await
			.map_err(|error| {
				tg::error!(
					source = error,
					"failed to create directory {}",
					target_path.display()
				)
			})?;
	}

	let entries: Vec<_> = out_dir.entries(tg).await?.into_iter().collect();

	let futures = entries.into_iter().map(|(name, artifact)| {
		let target_path = target_path.to_owned();
		async move {
			let to = target_path.join(&name);

			// Remove existing file/symlink if present.
			if to.exists() || to.is_symlink() {
				if to.is_dir() {
					tokio::fs::remove_dir_all(&to).await.ok();
				} else {
					tokio::fs::remove_file(&to).await.ok();
				}
			}

			match artifact {
				tg::Artifact::Directory(dir) => {
					// Recurse into subdirectories.
					Box::pin(write_out_dir_to_cargo(tg, &dir, &to)).await?;
				},
				tg::Artifact::File(file) => {
					let bytes = file.bytes(tg).await?;
					tokio::fs::write(&to, &bytes).await.map_err(|error| {
						tg::error!(source = error, "failed to write file {}", to.display())
					})?;
					// Set appropriate permissions.
					let is_executable = file.executable(tg).await.unwrap_or(false);
					let mode = if is_executable { 0o755 } else { 0o644 };
					let permissions = std::fs::Permissions::from_mode(mode);
					tokio::fs::set_permissions(&to, permissions)
						.await
						.map_err(|error| {
							tg::error!(
								source = error,
								"failed to set permissions on {}",
								to.display()
							)
						})?;
				},
				tg::Artifact::Symlink(symlink) => {
					// Resolve the symlink to its underlying artifact.
					if let Some(resolved) = symlink.try_resolve(tg).await? {
						match resolved {
							tg::Artifact::File(file) => {
								let bytes = file.bytes(tg).await?;
								tokio::fs::write(&to, &bytes).await.map_err(|error| {
									tg::error!(
										source = error,
										"failed to write file {}",
										to.display()
									)
								})?;
							},
							tg::Artifact::Directory(dir) => {
								Box::pin(write_out_dir_to_cargo(tg, &dir, &to)).await?;
							},
							tg::Artifact::Symlink(symlink) => {
								// Nested symlinks with artifacts are not expected in OUT_DIR.
								return Err(tg::error!(
									"unexpected nested symlink artifact in OUT_DIR: {symlink:?}"
								));
							},
						}
					} else if let Some(path) = symlink.path(tg).await? {
						// Relative path symlink without an artifact.
						tokio::fs::symlink(&path, &to).await.map_err(|error| {
							tg::error!(source = error, "failed to create symlink {}", to.display())
						})?;
					}
				},
			}

			Ok::<_, tg::Error>(())
		}
	});

	futures::future::try_join_all(futures).await?;

	Ok(())
}

/// Process extern crate dependencies into command args.
///
/// Creates wrapper directories for file artifacts and uses them in --extern args.
/// All wrapper directories are batch-stored in a single daemon RPC by collecting
/// them into a parent directory, then batch-cached in a single HTTP call.
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
				return Ok((
					vec!["--extern".to_owned().into(), name.into()],
					Vec::new(),
					None,
				));
			}

			let file_path = PathBuf::from(&path);

			let filename = file_path
				.file_name()
				.and_then(|s| s.to_str())
				.ok_or_else(|| tg::error!("extern path has no filename: {path}"))?
				.to_owned();

			let artifact = process::follow_and_resolve(tg, &path)
				.await?
				.try_unwrap_file()
				.map_err(|_| tg::error!("expected file for extern crate '{name}'"))?;

			// Put the file directly in a directory to preserve the filename.
			// When Tangram renders this, it creates a symlink to the file artifact.
			let wrapped =
				tg::Directory::with_entries([(filename.clone(), artifact.clone().into())].into());

			// Collect IDs for batch caching instead of caching individually.
			let cache_ids = vec![artifact.id().into()];

			let template = tg::Template {
				components: vec![
					format!("{name}=").into(),
					wrapped.clone().into(),
					format!("/{filename}").into(),
				],
			};
			Ok::<_, tg::Error>((
				vec!["--extern".to_owned().into(), template.into()],
				cache_ids,
				Some((name, wrapped)),
			))
		}
	});

	let results: Vec<(Vec<tg::Value>, Vec<tg::artifact::Id>, Option<(String, tg::Directory)>)> =
		futures::future::try_join_all(futures).await?;

	// Batch-store all wrapper directories in a single daemon RPC by collecting
	// them into a parent directory. Value::store() recursively collects all
	// unstored children and sends them in one /objects/batch call.
	let batch_entries: BTreeMap<String, tg::Artifact> = results
		.iter()
		.filter_map(|(_, _, wrapper)| {
			wrapper
				.as_ref()
				.map(|(name, dir)| (name.clone(), dir.clone().into()))
		})
		.collect();
	if !batch_entries.is_empty() {
		let batch_dir = tg::Directory::with_entries(batch_entries);
		batch_dir.store(tg).await?;
	}

	// Batch cache all artifact IDs (file artifacts + now-stored wrapper directories).
	let mut all_cache_ids: Vec<tg::artifact::Id> =
		results.iter().flat_map(|(_, ids, _)| ids.clone()).collect();
	all_cache_ids.extend(results.iter().filter_map(|(_, _, wrapper)| {
		wrapper.as_ref().map(|(_, dir)| dir.id().into())
	}));
	process::batch_cache(tg, all_cache_ids).await?;

	Ok(results.into_iter().flat_map(|(args, _, _)| args).collect())
}

/// Process dependency directories into a merged artifact directory.
///
/// Performs a single `read_dir` pass over each dependency directory to simultaneously
/// build the externs map (for transitive closure BFS) and catalog dependency files,
/// avoiding the overhead of scanning directories twice.
async fn process_dependencies(
	tg: &impl tg::Handle,
	dependencies: &[String],
	externs: &[(String, String)],
	crate_name: &str,
) -> tg::Result<Vec<tg::Value>> {
	use std::collections::{HashMap, HashSet, VecDeque};

	// Single-pass scan: build externs map and file catalog simultaneously.
	let mut externs_map: HashMap<String, HashSet<String>> = HashMap::new();
	let mut file_catalog: BTreeMap<String, String> = BTreeMap::new();

	for dep in dependencies {
		let Ok(entries) = std::fs::read_dir(dep) else {
			continue;
		};
		for entry in entries.flatten() {
			let path = entry.path();
			let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
				continue;
			};
			let ext = path.extension().and_then(|e| e.to_str());

			// Read .externs files into the externs map for BFS.
			if ext == Some("externs") {
				if let Some(stem) = extract_stem(name) {
					if let Ok(content) = std::fs::read_to_string(&path) {
						let deps: HashSet<String> = content
							.lines()
							.map(|s| s.trim().to_owned())
							.filter(|s| !s.is_empty())
							.collect();
						externs_map.insert(stem.to_owned(), deps);
					}
				}
				continue;
			}

			// Skip .d files.
			if ext == Some("d") {
				continue;
			}

			// Catalog non-.externs, non-.d files with their targets.
			let Some(stem) = extract_stem(name) else {
				continue;
			};
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
				// The stem is re-extracted during the filter step after BFS.
				let _ = stem;
				file_catalog.entry(name.to_owned()).or_insert(target);
			}
		}
	}

	// BFS to compute transitive closure using stems.
	let mut needed_stems: HashSet<String> = HashSet::new();
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
		if !needed_stems.insert(stem.clone()) {
			continue;
		}
		if let Some(deps) = externs_map.get(&stem) {
			for dep_stem in deps {
				if !needed_stems.contains(dep_stem) {
					queue.push_back(dep_stem.clone());
				}
			}
		}
	}

	_ = crate_name;
	#[cfg(feature = "tracing")]
	tracing::info!(
		crate_name,
		closure_size = needed_stems.len(),
		"transitive_closure_computed"
	);

	// Filter the catalog to only files whose stems are in the transitive closure.
	let files: BTreeMap<String, String> = file_catalog
		.into_iter()
		.filter(|(name, _)| {
			extract_stem(name).is_some_and(|stem| needed_stems.contains(stem))
		})
		.collect();

	// Resolve all files to artifacts without caching individually.
	let futures = files.iter().map(|(name, path)| {
		let name = name.clone();
		let path = path.clone();
		async move {
			let artifact = process::resolve_path_to_artifact(tg, &path).await.ok()?;
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
	process::batch_cache(tg, all_cache_ids).await?;
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
	process::batch_cache(tg, dep_artifact_ids).await?;

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
				process::symlink_cached_artifact(&artifact, &to).await?;
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

/// Extract the full stem (crate name + metadata hash) from a library filename.
fn extract_stem(filename: &str) -> Option<&str> {
	let stem = Path::new(filename).file_stem()?.to_str()?;
	Some(stem.strip_prefix("lib").unwrap_or(stem))
}

/// Check whether a filename has a dependency file extension (rlib, rmeta, d, so, dylib).
fn is_dependency_file(filename: &str) -> bool {
	Path::new(filename)
		.extension()
		.is_some_and(|ext| matches!(ext.to_str(), Some("rlib" | "rmeta" | "d" | "so" | "dylib")))
}

/// Strip the rustc metadata suffix from a filename and convert underscores to hyphens.
fn strip_metadata_suffix(filename: &str) -> Option<String> {
	// Split at the last hyphen, which separates the crate name from the metadata.
	let (name, metadata) = filename.rsplit_once('-')?;

	// The metadata should be a non-empty hex string (rustc metadata hash).
	if metadata.is_empty() || !metadata.chars().all(|c| c.is_ascii_hexdigit()) {
		return None;
	}

	// Convert underscores to hyphens in the crate name.
	Some(name.replace('_', "-"))
}

/// Create a filtered workspace directory for the runner.
///
/// Checks in the full workspace source, then replaces each sibling workspace member's
/// `.rs` files with empty placeholders. This preserves:
/// - The current crate's full content (needed by the build script)
/// - Workspace-level files (Cargo.toml, Cargo.lock, `node_modules`, etc.)
/// - Sibling members' Cargo.toml (needed for workspace dependency resolution)
/// - Sibling members' non-Rust files (e.g., `.d.ts`, `.ts`, `.js` assets that
///   build scripts may copy or reference)
///
/// Only `.rs` source files in sibling members are replaced, since these change
/// frequently during development and are not read by other members' build scripts.
/// This makes the filtered artifact stable when only sibling Rust source changes,
/// preventing runner cache miss cascades with non-deterministic build scripts.
async fn create_filtered_workspace(
	tg: &impl tg::Handle,
	source_dir: &str,
	current_crate_subpath: &str,
) -> tg::Result<tg::Value> {
	// Check in the full workspace.
	let workspace_value = process::content_address_path(tg, source_dir).await?;

	// Try to parse workspace members. If parsing fails, fall back to the full workspace.
	let Some(members) = parse_workspace_members(source_dir) else {
		#[cfg(feature = "tracing")]
		tracing::warn!("could not parse workspace members, using full workspace source");
		return Ok(workspace_value);
	};

	// Extract the directory artifact from the template returned by content_address_path.
	let workspace_dir = match &workspace_value {
		tg::Value::Template(t) => t
			.components
			.iter()
			.find_map(|c| match c {
				tg::template::Component::Artifact(a) => a.try_unwrap_directory_ref().ok(),
				_ => None,
			})
			.cloned()
			.ok_or_else(|| tg::error!("expected a directory artifact in the workspace template"))?,
		_ => return Ok(workspace_value),
	};

	// Create a single placeholder file to reuse for all replaced `.rs` files.
	let placeholder_blob =
		tg::Blob::with_reader(tg, std::io::Cursor::new(b"// placeholder\n")).await?;
	let placeholder_file: tg::Artifact = tg::File::builder(placeholder_blob).build().into();

	// Replace `.rs` files in each sibling member with placeholders concurrently.
	// The expensive I/O (fetching member directories and replacing files) is parallelized,
	// then results are applied to the builder sequentially (builder mutation is inherently sequential).
	let sibling_paths: Vec<&String> = members
		.iter()
		.filter(|m| m.as_str() != current_crate_subpath)
		.collect();

	let member_futures = sibling_paths.iter().map(|member_path| {
		let member_path = (*member_path).clone();
		let workspace_dir = workspace_dir.clone();
		let placeholder_file = placeholder_file.clone();
		async move {
			let member_dir = match workspace_dir.get(tg, &member_path).await {
				Ok(artifact) => match artifact.try_unwrap_directory() {
					Ok(dir) => dir,
					Err(_) => return Ok::<_, tg::Error>(None),
				},
				Err(_) => return Ok(None),
			};
			let filtered =
				replace_rs_files_with_placeholder(tg, &member_dir, &placeholder_file).await?;
			Ok(Some((member_path, filtered)))
		}
	});
	let filtered_members: Vec<Option<(String, tg::Directory)>> =
		futures::future::try_join_all(member_futures).await?;

	let mut builder = workspace_dir.builder(tg).await?;
	for entry in filtered_members.into_iter().flatten() {
		let (member_path, filtered_member) = entry;
		builder = builder
			.add(tg, Path::new(&member_path), filtered_member.into())
			.await?;
	}

	let filtered = builder.build();
	filtered.store(tg).await?;

	#[cfg(feature = "tracing")]
	tracing::info!(
		?current_crate_subpath,
		filtered_id = ?filtered.id(),
		member_count = members.len(),
		"created filtered workspace for runner"
	);

	Ok(tangram_std::template_from_artifact(filtered.into()).into())
}

/// Recursively replace `.rs` files in a directory with a placeholder artifact.
/// Non-`.rs` files and subdirectory structure are preserved.
async fn replace_rs_files_with_placeholder(
	tg: &impl tg::Handle,
	dir: &tg::Directory,
	placeholder: &tg::Artifact,
) -> tg::Result<tg::Directory> {
	let entries = dir.entries(tg).await?;
	let mut new_entries: BTreeMap<String, tg::Artifact> = BTreeMap::new();
	for (name, artifact) in entries {
		if std::path::Path::new(&name)
			.extension()
			.is_some_and(|ext| ext.eq_ignore_ascii_case("rs"))
		{
			new_entries.insert(name, placeholder.clone());
		} else if let Ok(sub_dir) = artifact.clone().try_unwrap_directory() {
			let filtered =
				Box::pin(replace_rs_files_with_placeholder(tg, &sub_dir, placeholder)).await?;
			new_entries.insert(name, filtered.into());
		} else {
			new_entries.insert(name, artifact);
		}
	}
	Ok(tg::Directory::with_entries(new_entries))
}

/// Parse workspace member paths from the workspace Cargo.toml.
///
/// Extracts the `members` array from the `[workspace]` section and expands
/// glob patterns (e.g., `"packages/*"`) by listing matching directories that
/// contain a Cargo.toml.
fn parse_workspace_members(source_dir: &str) -> Option<Vec<String>> {
	let content = std::fs::read_to_string(Path::new(source_dir).join("Cargo.toml")).ok()?;
	let doc = content.parse::<toml_edit::DocumentMut>().ok()?;
	let patterns = doc["workspace"]["members"].as_array()?;
	let mut members = Vec::new();
	for item in patterns {
		let pattern = item.as_str()?;
		if pattern.contains(['*', '?', '[']) {
			members.extend(expand_member_glob(source_dir, pattern));
		} else {
			members.push(pattern.to_owned());
		}
	}
	Some(members)
}

/// Expand a workspace member glob pattern by listing matching directories.
fn expand_member_glob(source_dir: &str, pattern: &str) -> Vec<String> {
	let full_pattern = Path::new(source_dir).join(pattern).join("Cargo.toml");
	let Some(full_pattern) = full_pattern.to_str() else {
		return Vec::new();
	};
	let Ok(paths) = glob::glob(full_pattern) else {
		return Vec::new();
	};
	paths
		.filter_map(|entry| {
			let path = entry.ok()?;
			// The parent of Cargo.toml is the member directory.
			let member_dir = path.parent()?;
			member_dir
				.strip_prefix(source_dir)
				.ok()?
				.to_str()
				.map(ToOwned::to_owned)
		})
		.collect()
}

// Environment variables that must be filtered out before invoking the driver target.
// These either:
// - Are used only by the outer proxy (not the inner driver)
// - Vary per outer build and would pollute the inner process's cache key
const BLACKLISTED_ENV_VARS: [&str; 20] = [
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
	// Language-specific path vars that rustc does not need.
	"NODE_PATH",
	"PYTHONPATH",
	// CARGO_HOME is cargo-specific; rustc does not use it.
	"CARGO_HOME",
	// CARGO_MANIFEST_DIR/PATH contain workspace root which varies.
	// Rustc does not need these; we set current_dir to the crate source.
	"CARGO_MANIFEST_DIR",
	"CARGO_MANIFEST_PATH",
	// CARGO_MAKEFLAGS contains jobserver file descriptors that are non-deterministic.
	// The inner rustc process does not use make flags.
	"CARGO_MAKEFLAGS",
	// Library path vars are non-deterministic (contain cargo target dir). The inner
	// rustc receives its dependencies through explicit --extern and -L args.
	"DYLD_FALLBACK_LIBRARY_PATH",
	"LD_LIBRARY_PATH",
];

// Environment variables that must be filtered out in runner mode.
// These either vary per outer build or are set by the inner driver.
const RUNNER_BLACKLISTED_ENV_VARS: [&str; 21] = [
	// Proxy/runner-specific vars.
	"TGRUSTC_TRACING",
	"TGRUSTC_DRIVER_EXECUTABLE",
	"TGRUSTC_RUNNER_DRIVER_MODE",
	"TGRUSTC_RUNNER_SOURCE",
	// Tangram vars.
	"TANGRAM_HOST",
	"TANGRAM_URL",
	"TANGRAM_OUTPUT",
	"TANGRAM_PROCESS",
	// Build-specific paths that vary per cargo invocation.
	"HOME",
	"PWD",
	"TARGET_DIR",
	"CARGO_TARGET_DIR",
	"SOURCE",
	// OUT_DIR is the output, not an input. The inner driver sets it.
	"OUT_DIR",
	// CARGO_HOME is cargo-specific.
	"CARGO_HOME",
	// CARGO_MANIFEST_DIR varies with the build. The inner driver sets it from TGRUSTC_RUNNER_SOURCE.
	"CARGO_MANIFEST_DIR",
	"CARGO_MANIFEST_PATH",
	// RUSTC_WRAPPER is used by cargo for the proxy, not relevant inside build scripts.
	"RUSTC_WRAPPER",
	// CARGO_MAKEFLAGS contains jobserver fds that do not work inside the Tangram sandbox.
	"CARGO_MAKEFLAGS",
	// DYLD_FALLBACK_LIBRARY_PATH and LD_LIBRARY_PATH include the cargo target
	// directory, which changes between builds. Build scripts in the Tangram sandbox
	// receive their library dependencies through the command's artifacts, not
	// through these paths.
	"DYLD_FALLBACK_LIBRARY_PATH",
	"LD_LIBRARY_PATH",
];
