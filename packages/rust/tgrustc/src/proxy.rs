use crate::{args::Args, driver::RUNNER_OUT_DIR_PLACEHOLDER, process};
use std::{
	collections::{BTreeMap, HashMap, HashSet, VecDeque},
	os::unix::fs::PermissionsExt,
	path::{Path, PathBuf},
};
use tangram_client::prelude::*;

type ExternResult = (
	Vec<tg::Value>,
	Vec<tg::artifact::Id>,
	Option<(String, tg::Directory)>,
);

pub(crate) async fn run_proxy(args: Args) -> tg::Result<()> {
	run_proxy_inner(&args).await
}

#[allow(clippy::too_many_lines)]
async fn run_proxy_inner(args: &Args) -> tg::Result<()> {
	let start_time = std::time::Instant::now();
	let display_name = if args.crate_name.starts_with("build_script_") {
		if let Ok(pkg) = std::env::var("CARGO_PKG_NAME") {
			// Normalize hyphens to match cargo's --crate-name convention.
			format!("{}({})", args.crate_name, pkg.replace('-', "_"))
		} else {
			args.crate_name.clone()
		}
	} else {
		args.crate_name.clone()
	};

	let _span = tracing::info_span!("rustc_proxy", crate = %display_name).entered();

	let source_future = async {
		let _span = tracing::info_span!("checkin_source").entered();
		let manifest_dir = &args.source_directory;

		if process::is_artifact_path(manifest_dir) {
			let (artifact, subpath) = process::extract_artifact_from_path(manifest_dir).await?;
			tracing::info!(id = ?artifact.id(), ?subpath, "resolved crate source from artifact path");
			Ok::<_, tg::Error>((
				tangram_std::template_from_artifact(artifact).into(),
				subpath,
			))
		} else {
			tracing::info!(?manifest_dir, "checking in crate source directory");
			Ok((process::content_address_path(manifest_dir).await?, None))
		}
	};

	// Passed as TGRUSTC_OUT_DIR to the inner driver (e.g. cc-rs compiled libs).
	let out_dir_future = async {
		let _span = tracing::info_span!("checkin_out_dir").entered();

		if let Some(path) = &args.cargo_out_directory {
			let out_dir_path = PathBuf::from(path);

			let artifact = tg::checkin(tg::checkin::Arg {
				options: tg::checkin::Options {
					deterministic: true,
					ignore: false,
					lock: None,
					root: true,
					..Default::default()
				},
				path: out_dir_path.clone(),
				updates: vec![],
			})
			.await?;

			tracing::info!(?path, artifact_id = ?artifact.id(), "checked in OUT_DIR");

			Ok::<_, tg::Error>(tangram_std::template_from_artifact(artifact).into())
		} else {
			let empty_dir = tg::Directory::with_entries(BTreeMap::new());
			empty_dir.store().await?;
			Ok(tangram_std::template_from_artifact(empty_dir.into()).into())
		}
	};

	let resolve_exe_future = async {
		let _span = tracing::info_span!("resolve_exe").entered();
		process::resolve_executable().await
	};

	let ((source_directory, crate_subpath), out_dir, executable): (
		(tg::Value, Option<String>),
		tg::Value,
		tg::command::Executable,
	) = futures::future::try_join3(source_future, out_dir_future, resolve_exe_future).await?;

	// Real filesystem path (crate_subpath=None): derive from the workspace root so
	// workspace-relative source paths get rewritten to crate-relative paths.
	// Canonicalize both sides for macOS /var → /private/var symlinks.
	let crate_subpath = crate_subpath.or_else(|| {
		let project_dir = std::env::var("TGRUSTC_PASSTHROUGH_PROJECT_DIR").ok()?;
		let source = std::fs::canonicalize(&args.source_directory).ok()?;
		let project = std::fs::canonicalize(&project_dir).ok()?;
		source
			.strip_prefix(&project)
			.ok()
			.map(|p| p.to_string_lossy().to_string())
			.filter(|s| !s.is_empty())
	});

	// `tg::process::env()` merges `TANGRAM_ENV_*` companions into rich pre-parsed
	// values; plain vars arrive as `tg::Value::String`. In run mode, an allowlist
	// prevents session-specific host vars from polluting `command_id`; cargo-added
	// vars (from `cargo:rustc-env`) are detected via a pre-cargo snapshot.
	let run_mode = std::env::var("TGRUSTC_RUN_MODE").is_ok();
	let host_env_snapshot = load_host_env_snapshot();
	let mut env = BTreeMap::new();
	let mut pending_env: Vec<(String, String)> = Vec::new();
	for (name, value) in tg::process::env()? {
		if is_excluded_proxy_env(&name) || name == "CARGO_MANIFEST_DIR" {
			continue;
		}
		match value {
			tg::Value::String(s) => {
				let include = is_allowed_proxy_env(&name)
					|| is_cargo_target_var(&name)
					|| process::is_artifact_path(&s)
					|| is_cargo_added_env(&name, host_env_snapshot.as_ref(), run_mode);
				if !include {
					continue;
				}
				let needs_checkin = s.starts_with('/')
					&& !process::is_artifact_path(&s)
					&& std::path::Path::new(&s).exists();
				if needs_checkin {
					pending_env.push((name, s));
				} else {
					let value = tangram_std::unrender(&s)?;
					env.insert(name, value.into());
				}
			},
			// Rich values from `TANGRAM_ENV_*` companions — already resolved.
			other => {
				env.insert(name, other);
			},
		}
	}
	if !pending_env.is_empty() {
		let _span = tracing::info_span!("resolve_env", count = pending_env.len()).entered();
		tracing::info!(
			vars = ?pending_env.iter().map(|(n, _)| n.as_str()).collect::<Vec<_>>(),
			"resolving env vars that need checkin"
		);
		let resolve_futures = pending_env.iter().map(|(_, path)| {
			let path = path.clone();
			async move { process::content_address_path(&path).await }
		});
		let resolved: Vec<tg::Value> = futures::future::try_join_all(resolve_futures).await?;
		for ((name, _), value) in pending_env.into_iter().zip(resolved) {
			env.insert(name, value);
		}
	}

	let rustc_for_inner =
		std::env::var("TGRUSTC_TANGRAM_RUSTC").unwrap_or_else(|_| args.rustc.clone());
	let rustc_template = tangram_std::unrender(&rustc_for_inner)?;
	env.insert("TGRUSTC_DRIVER_MODE".to_owned(), "1".to_owned().into());
	env.insert("TGRUSTC_RUSTC".to_owned(), rustc_template.into());
	env.insert("TGRUSTC_SOURCE".to_owned(), source_directory.clone());
	env.insert("TGRUSTC_OUT_DIR".to_owned(), out_dir.clone());
	// For proc-macros that read Cargo.toml.
	env.insert("CARGO_MANIFEST_DIR".to_owned(), source_directory.clone());
	// Outer TMPDIR points at outer sandbox scratch; pin to `/tmp`.
	env.insert("TMPDIR".to_owned(), "/tmp".to_owned().into());

	// Cannot be on the host's PATH (wrapped clang breaks passthrough).
	if let Ok(sdk_path) = std::env::var("TGRUSTC_SANDBOX_SDK") {
		let sdk_template = tangram_std::unrender(&sdk_path)?;
		let mut components = sdk_template.components;
		components.push("/bin".to_owned().into());
		env.insert("PATH".to_owned(), tg::Template { components }.into());
	}

	tracing::info!(?source_directory, "source_directory value for inner build");

	// Two-pass: first push None placeholders for args needing content-addressing,
	// then resolve them concurrently.
	let mut command_args: Vec<Option<tg::Value>> = vec![];
	let mut pending: Vec<(usize, String, bool)> = vec![]; // (index, path, is_native)

	let mut remaining_iter = args.remaining.iter();
	while let Some(arg) = remaining_iter.next() {
		// Rewrite --remap-path-prefix workspace root to the crate-specific source
		// so `command_id` is stable across workspace changes.
		if arg == "--remap-path-prefix"
			&& let Some(remap_value) = remaining_iter.next()
		{
			command_args.push(Some("--remap-path-prefix".to_owned().into()));
			if let Some((old, new)) = remap_value.split_once('=') {
				if args.source_directory.starts_with(old) {
					let mut components: Vec<tg::template::Component> = match &source_directory {
						tg::Value::Template(t) => t.components.clone(),
						_ => unreachable!("source_directory is always a template"),
					};
					components.push(format!("={new}").into());
					command_args.push(Some(tg::Template { components }.into()));
				} else {
					command_args.push(Some(remap_value.clone().into()));
				}
			} else {
				command_args.push(Some(remap_value.clone().into()));
			}
			continue;
		}

		// Drop `-C incremental=<path>`: the path doesn't exist in the sandbox
		// and would pollute `command_id`.
		if arg == "-C" {
			let mut peek = remaining_iter.clone();
			if peek.next().is_some_and(|a| a.starts_with("incremental=")) {
				remaining_iter.next();
				continue;
			}
		}

		if let Some(native_path) = arg.strip_prefix("native=") {
			let idx = command_args.len();
			command_args.push(None);
			pending.push((idx, native_path.to_owned(), true));
			continue;
		}

		// Rewrite source file paths to be crate-relative; the inner driver
		// chdirs into the source directory artifact.
		{
			let is_source_file = std::path::Path::new(arg)
				.extension()
				.is_some_and(|ext| ext.eq_ignore_ascii_case("rs"))
				&& !arg.starts_with('-');
			if is_source_file {
				let stripped = crate_subpath
					.as_ref()
					.and_then(|subpath| arg.strip_prefix(subpath.as_str()))
					.or_else(|| arg.strip_prefix(args.source_directory.as_str()));
				if let Some(relative_path) = stripped {
					let relative_path = relative_path.trim_start_matches('/');
					if !relative_path.is_empty() {
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
		}

		if !arg.starts_with('/') && !arg.contains("/.tangram/") {
			command_args.push(Some(arg.clone().into()));
			continue;
		}

		let idx = command_args.len();
		command_args.push(None);
		pending.push((idx, arg.clone(), false));
	}

	if !pending.is_empty() {
		let _span = tracing::info_span!("resolve_args", count = pending.len()).entered();
		let resolve_futures = pending.iter().map(|(_, path, _)| {
			let path = path.clone();
			async move { process::content_address_path(&path).await }
		});
		let resolved: Vec<tg::Value> = futures::future::try_join_all(resolve_futures).await?;
		for ((idx, _, is_native), value) in pending.iter().zip(resolved) {
			let final_value = if *is_native {
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

	let mut command_args: Vec<tg::Value> = command_args.into_iter().map(|v| v.unwrap()).collect();

	let (extern_args, dep_args) = {
		let _span = tracing::info_span!(
			"process_deps",
			externs = args.externs.len(),
			deps = args.dependencies.len()
		)
		.entered();

		futures::future::try_join(
			process_externs(&args.externs),
			process_dependencies(&args.dependencies, &args.externs, &args.crate_name),
		)
		.await?
	};
	command_args.extend(extern_args);
	command_args.extend(dep_args);

	let host = crate::host().to_string();
	tracing::info!(?host, "creating inner process");

	let command = tg::Command::builder()
		.host(host)
		.executable(executable)
		.args(command_args)
		.env(env)
		.finish()?;
	let store_start = std::time::Instant::now();
	let command_id = command.store().await?;
	tracing::info!(store_ms = store_start.elapsed().as_millis(), %command_id, "stored command");
	let mut command_ref = tg::Referent::with_item(command_id.clone());
	command_ref
		.options
		.name
		.replace(format!("rustc {display_name}"));

	let description = format!("Inner process for crate '{display_name}'");
	let result = process::spawn_and_wait(command_ref, &description).await?;

	{
		let output_id = result.output.id();
		tracing::info!(?output_id, cached = result.cached, "got output");
	}

	let ((stdout, stderr), build_dir) =
		futures::future::try_join(process::read_logs(&result.output), async {
			let dir = result
				.output
				.get("build")
				.await?
				.try_unwrap_directory()
				.map_err(|_| {
					tg::error!(
						"expected 'build' directory in output from process {}",
						result.process_id
					)
				})?;
			{
				let build_dir_id = dir.id();
				tracing::info!(?build_dir_id, "got build directory");
			}
			Ok::<_, tg::Error>(dir)
		})
		.await?;

	{
		let _span = tracing::info_span!("write_outputs").entered();

		let output_directory = PathBuf::from(
			args.rustc_output_directory
				.as_deref()
				.ok_or_else(|| tg::error!("expected --out-dir argument from cargo"))?,
		);
		write_outputs_to_cargo(&build_dir, &output_directory, &args.externs).await?;
	}

	// Forward logs only after outputs are on disk — cargo watches for the
	// JSON message announcing .rmeta readiness.
	process::forward_logs(&stdout, &stderr).await?;

	{
		let elapsed = start_time.elapsed();
		tracing::info!(
			crate_name = %display_name,
			elapsed_ms = elapsed.as_millis(),
			cached = result.cached,
			process_id = %result.process_id,
			command_id = %command_id,
			"proxy_complete"
		);
	}

	Ok(())
}

/// Outer runner: content-address inputs, spawn a Tangram process for build
/// script execution, then write outputs back to cargo's `OUT_DIR`.
#[allow(clippy::too_many_lines)]
pub(crate) async fn run_runner() -> tg::Result<()> {
	let start_time = std::time::Instant::now();

	// argv[0]=tgrustc, argv[1]="runner".
	let script_binary = std::env::args()
		.nth(2)
		.ok_or_else(|| tg::error!("expected build script binary path after 'runner'"))?;

	let crate_name = std::env::var("CARGO_PKG_NAME").unwrap_or_else(|_| "unknown".into());

	let _span =
		tracing::info_span!("runner", crate = %crate_name, binary = %script_binary).entered();

	// Bypass runner for crates incompatible with sandbox capture (e.g. rusty_v8
	// walks up from OUT_DIR). Comma-separated list of crate names.
	if let Ok(passthrough) = std::env::var("TGRUSTC_RUNNER_PASSTHROUGH")
		&& passthrough.split(',').any(|s| s.trim() == crate_name)
	{
		tracing::info!(%crate_name, "passthrough: bypassing runner sandbox");
		let remaining_args: Vec<String> = std::env::args().skip(2).collect();

		let status = std::process::Command::new(&remaining_args[0])
			.args(&remaining_args[1..])
			.status();

		match status {
			Ok(s) if s.success() => {
				tracing::info!(%crate_name, "passthrough: build script succeeded");
				std::process::exit(0);
			},
			Ok(s) => {
				let code = s.code().unwrap_or(1);
				tracing::error!(%crate_name, exit_code = code, "passthrough: build script failed");
				std::process::exit(code);
			},
			Err(e) => {
				return Err(tg::error!("failed to spawn build script: {e}"));
			},
		}
	}

	let script_future = async {
		let contents = tokio::fs::read(&script_binary)
			.await
			.map_err(|e| tg::error!("failed to read build script binary: {e}"))?;
		let blob = tg::Blob::with_reader(std::io::Cursor::new(contents)).await?;
		let file = tg::File::builder(blob).executable(true).build();
		let artifact: tg::Artifact = file.into();
		Ok::<_, tg::Error>(tangram_std::template_from_artifact(artifact).into())
	};

	let source_future = async {
		let manifest_dir = crate::required_env("CARGO_MANIFEST_DIR")?;

		let subpath = std::env::var("TGRUSTC_SOURCE_DIR").ok().and_then(|source| {
			Path::new(&manifest_dir)
				.strip_prefix(&source)
				.ok()
				.map(|p| p.to_string_lossy().to_string())
				.filter(|s| !s.is_empty())
		});

		if let Some(ref subpath) = subpath {
			// Workspace member: replace sibling members with stub Cargo.toml dirs
			// so the runner's `command_id` is unaffected by their source changes.
			let source_dir = std::env::var("TGRUSTC_SOURCE_DIR").unwrap();
			let source_value = create_filtered_workspace(&source_dir, subpath).await?;
			Ok::<_, tg::Error>((source_value, subpath.clone()))
		} else {
			let ca_value = process::content_address_path(&manifest_dir).await?;
			Ok::<_, tg::Error>((ca_value, String::new()))
		}
	};

	let (script_value, (source_value, manifest_subpath), executable): (
		tg::Value,
		(tg::Value, String),
		tg::command::Executable,
	) = futures::future::try_join3(script_future, source_future, process::resolve_executable())
		.await?;

	// Iterate `std::env::vars()` (not `tg::process::env()`) so shell-applied
	// modifications from the cargo `pre` script (e.g. `export PATH="$PATH:$NODE_PATH/.bin"`)
	// are captured. `tg::process::env()` would overwrite plain values with
	// `TANGRAM_ENV_*` companions serialized at tgrustc spawn time, missing later
	// in-shell exports; unrendering the live string still recovers artifact
	// references. `TANGRAM_ENV_*` keys are reserved outputs, not inputs.
	let mut env = BTreeMap::new();
	let mut env_pending: Vec<(String, String)> = Vec::new();
	let run_mode = std::env::var("TGRUSTC_RUN_MODE").is_ok();
	for (name, s) in std::env::vars() {
		if is_excluded_proxy_env(&name) || name == "CARGO_MANIFEST_DIR" {
			continue;
		}
		if name.starts_with(tg::process::env::PREFIX) {
			continue;
		}
		// Run mode: allow values that are artifact paths (e.g. RUSTY_V8_ARCHIVE).
		let include = !run_mode || is_allowed_runner_env(&name) || process::is_artifact_path(&s);
		if !include {
			continue;
		}
		if name == "PATH" {
			env.insert(name, tangram_std::unrender(&s)?.into());
		} else {
			let needs_checkin = s.starts_with('/') && std::path::Path::new(&s).exists();
			if needs_checkin {
				env_pending.push((name, s));
			} else {
				let resolved = tangram_std::unrender(&s)?;
				env.insert(name, resolved.into());
			}
		}
	}
	if !env_pending.is_empty() {
		let env_futures = env_pending.iter().map(|(name, value)| {
			let name = name.clone();
			let value = value.clone();
			async move {
				process::content_address_path(&value).await.map_err(|e| {
					tg::error!("failed to content-address env var {name}={value}: {e}")
				})
			}
		});
		let resolved: Vec<tg::Value> = futures::future::try_join_all(env_futures).await?;
		for ((name, _), value) in env_pending.into_iter().zip(resolved) {
			env.insert(name, value);
		}
	}

	if let Ok(sdk_path) = std::env::var("TGRUSTC_SANDBOX_SDK") {
		let mut prefix = tangram_std::unrender(&sdk_path)?.components;
		prefix.push("/bin".to_owned().into());
		prepend_to_path(&mut env, prefix);
	}

	// Caller-injected tool paths unreachable via standard PATH mutations.
	if let Ok(extra_path) = std::env::var("TGRUSTC_RUNNER_EXTRA_PATH") {
		let prefix = tangram_std::unrender(&extra_path)?.components;
		prepend_to_path(&mut env, prefix);
	}

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

	let command_args: Vec<tg::Value> = vec![script_value];

	let host_str = crate::host().to_string();
	let command = tg::Command::builder()
		.host(host_str)
		.executable(executable)
		.args(command_args)
		.env(env)
		.finish()?;
	let command_id = command.store().await?;
	let mut command_ref = tg::Referent::with_item(command_id.clone());
	command_ref
		.options
		.name
		.replace(format!("build-script {crate_name}"));

	let description = format!("Runner process for crate '{crate_name}'");
	let result = process::spawn_and_wait(command_ref, &description).await?;

	let ((stdout, stderr), out_dir) =
		futures::future::try_join(process::read_logs(&result.output), async {
			result
				.output
				.get(RUNNER_OUT_DIR_PLACEHOLDER)
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

	let cargo_out_dir = crate::required_env("OUT_DIR")?;
	write_out_dir_to_cargo(&out_dir, &PathBuf::from(&cargo_out_dir)).await?;

	// Substitute OUT_DIR for the placeholder used by `run_runner_driver`.
	let stdout = {
		let text = String::from_utf8_lossy(&stdout);
		text.replace(RUNNER_OUT_DIR_PLACEHOLDER, &cargo_out_dir)
			.into_bytes()
	};
	process::forward_logs(&stdout, &stderr).await?;

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

async fn write_out_dir_to_cargo(out_dir: &tg::Directory, target_path: &Path) -> tg::Result<()> {
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

	let entries: Vec<_> = out_dir.entries().await?.into_iter().collect();

	let futures = entries.into_iter().map(|(name, artifact)| {
		let target_path = target_path.to_owned();
		async move {
			let to = target_path.join(&name);

			if to.exists() || to.is_symlink() {
				if to.is_dir() {
					tokio::fs::remove_dir_all(&to).await.ok();
				} else {
					tokio::fs::remove_file(&to).await.ok();
				}
			}

			match artifact {
				tg::Artifact::Directory(dir) => {
					Box::pin(write_out_dir_to_cargo(&dir, &to)).await?;
				},
				tg::Artifact::File(file) => {
					let bytes = file.bytes().await?;
					tokio::fs::write(&to, &bytes).await.map_err(|error| {
						tg::error!(source = error, "failed to write file {}", to.display())
					})?;
					let is_executable = file.executable().await.unwrap_or(false);
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
					if let Some(resolved) = symlink.try_resolve().await? {
						match resolved {
							tg::Artifact::File(file) => {
								let bytes = file.bytes().await?;
								tokio::fs::write(&to, &bytes).await.map_err(|error| {
									tg::error!(
										source = error,
										"failed to write file {}",
										to.display()
									)
								})?;
							},
							tg::Artifact::Directory(dir) => {
								Box::pin(write_out_dir_to_cargo(&dir, &to)).await?;
							},
							tg::Artifact::Symlink(symlink) => {
								return Err(tg::error!(
									"unexpected nested symlink artifact in OUT_DIR: {symlink:?}"
								));
							},
						}
					} else if let Some(path) = symlink.path().await? {
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

/// Creates wrapper directories per file artifact and batch-stores them in a single RPC.
async fn process_externs(externs: &[(String, String)]) -> tg::Result<Vec<tg::Value>> {
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

			let artifact = process::follow_and_resolve(&path)
				.await?
				.try_unwrap_file()
				.map_err(|_| tg::error!("expected file for extern crate '{name}'"))?;

			// Wrap in a directory to preserve the filename; Tangram renders this
			// as a symlink to the file artifact.
			let wrapped =
				tg::Directory::with_entries([(filename.clone(), artifact.clone().into())].into());

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

	let results: Vec<ExternResult> = futures::future::try_join_all(futures).await?;

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
		batch_dir.store().await?;
	}

	// No checkout — the server materializes on cache miss.
	Ok(results.into_iter().flat_map(|(args, _, _)| args).collect())
}

/// Single-pass scan per dependency dir builds the externs map (for BFS) and
/// file catalog together.
#[allow(clippy::too_many_lines)]
async fn process_dependencies(
	dependencies: &[String],
	externs: &[(String, String)],
	crate_name: &str,
) -> tg::Result<Vec<tg::Value>> {
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

			if ext == Some("externs") {
				if let Some(stem) = extract_stem(name)
					&& let Ok(content) = std::fs::read_to_string(&path)
				{
					let deps: HashSet<String> = content
						.lines()
						.map(|s| s.trim().to_owned())
						.filter(|s| !s.is_empty())
						.collect();
					externs_map.insert(stem.to_owned(), deps);
				}
				continue;
			}

			if ext == Some("d") {
				continue;
			}

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

	// A stem in needed_stems but not externs_map means that crate was compiled
	// without the proxy (plain `cargo build`); its transitive deps are unknown,
	// so fall back to including all dep files.
	let closure_complete = needed_stems
		.iter()
		.all(|stem| externs_map.contains_key(stem));

	let files: BTreeMap<String, String> = if closure_complete {
		tracing::info!(
			crate_name,
			closure_size = needed_stems.len(),
			"transitive_closure_computed"
		);
		file_catalog
			.into_iter()
			.filter(|(name, _)| extract_stem(name).is_some_and(|stem| needed_stems.contains(stem)))
			.collect()
	} else {
		tracing::info!(
			crate_name,
			closure_size = needed_stems.len(),
			catalog_size = file_catalog.len(),
			"incomplete .externs coverage, including all dependency files"
		);
		file_catalog
	};

	// Partition: checkin-cached (known IDs), artifact-store (unrender only),
	// real files (need tg::checkin, batched).
	let mut cached_entries: BTreeMap<String, tg::Artifact> = BTreeMap::new();
	let mut artifact_store_files: Vec<(String, String)> = Vec::new();
	let mut real_files: Vec<(String, String)> = Vec::new();
	for (name, target) in &files {
		if let Some(id) = process::read_checkin_cache(target) {
			cached_entries.insert(name.clone(), tg::Artifact::with_id(id));
		} else if process::is_artifact_path(target) {
			artifact_store_files.push((name.clone(), target.clone()));
		} else {
			real_files.push((name.clone(), target.clone()));
		}
	}

	tracing::info!(
		crate_name,
		cached = cached_entries.len(),
		artifact_store = artifact_store_files.len(),
		real = real_files.len(),
		"process_deps_resolution"
	);

	let artifact_futures = artifact_store_files.iter().map(|(name, path)| {
		let name = name.clone();
		let path = path.clone();
		async move {
			let artifact = process::resolve_path_to_artifact(&path).await.ok()?;
			Some((name, artifact))
		}
	});
	let mut entries: BTreeMap<String, tg::Artifact> = cached_entries;
	entries.extend(
		futures::future::join_all(artifact_futures)
			.await
			.into_iter()
			.flatten(),
	);

	if !real_files.is_empty() {
		match batch_checkin_files(dependencies, &real_files).await {
			Ok(batch_entries) => {
				entries.extend(batch_entries);
			},
			Err(e) => {
				tracing::warn!(%e, "batch checkin failed, falling back to individual checkins");
				let fallback_futures = real_files.iter().map(|(name, path)| {
					let name = name.clone();
					let path = path.clone();
					async move {
						let artifact = process::resolve_path_to_artifact(&path).await.ok()?;
						Some((name, artifact))
					}
				});
				let fallback: BTreeMap<String, tg::Artifact> =
					futures::future::join_all(fallback_futures)
						.await
						.into_iter()
						.flatten()
						.collect();
				entries.extend(fallback);
			},
		}
	}

	if entries.is_empty() {
		return Ok(vec![]);
	}

	let merged = tg::Directory::with_entries(entries);
	merged.store().await?;

	let template = tg::Template {
		components: vec!["dependency=".to_owned().into(), merged.into()],
	};
	Ok(vec!["-L".to_owned().into(), template.into()])
}

/// Hardlink files into a temp dir and issue one `tg::checkin` instead of N —
/// avoids daemon contention in `tg run` mode (where outputs are copied, not symlinked).
async fn batch_checkin_files(
	dependencies: &[String],
	files: &[(String, String)],
) -> tg::Result<BTreeMap<String, tg::Artifact>> {
	let dep_dir = dependencies
		.first()
		.ok_or_else(|| tg::error!("no dependency directories for batch checkin"))?;
	let tmp_dir = PathBuf::from(dep_dir).join(format!(".tg_batch_{}", std::process::id()));

	// Clean up any stale temp dir from a previous crashed invocation.
	if tmp_dir.exists() {
		std::fs::remove_dir_all(&tmp_dir).ok();
	}
	std::fs::create_dir_all(&tmp_dir).map_err(|e| {
		tg::error!(
			source = e,
			"failed to create batch checkin directory {}",
			tmp_dir.display()
		)
	})?;

	// Fall back to copy if hardlink fails (e.g., cross-filesystem).
	let mut linked = Vec::new();
	for (name, src_path) in files {
		let link_path = tmp_dir.join(name);
		if std::fs::hard_link(src_path, &link_path).is_err() {
			std::fs::copy(src_path, &link_path).map_err(|e| {
				tg::error!(
					source = e,
					"failed to hardlink or copy {} for batch checkin",
					src_path
				)
			})?;
		}
		linked.push(name.clone());
	}

	if linked.is_empty() {
		let _ = std::fs::remove_dir_all(&tmp_dir);
		return Ok(BTreeMap::new());
	}

	let result = tg::checkin(tg::checkin::Arg {
		options: tg::checkin::Options {
			destructive: false,
			deterministic: true,
			ignore: false,
			source_dependencies: false,
			root: true,
			solve: false,
			..Default::default()
		},
		path: tmp_dir.clone(),
		updates: vec![],
	})
	.await;

	// Clean up tmp regardless of checkin outcome.
	let _ = std::fs::remove_dir_all(&tmp_dir);

	let checked_in = result?;
	let checked_in_dir = checked_in
		.try_unwrap_directory()
		.map_err(|_| tg::error!("expected directory from batch checkin"))?;

	let dir_entries = checked_in_dir.entries().await?;
	Ok(dir_entries.into_iter().collect())
}

/// Copy (not symlink) outputs: artifact store files have mtime=0 which cargo's
/// fingerprinting treats as stale. Also writes `.externs` sidecars and convenience
/// symlinks for metadata-suffixed binaries.
#[allow(clippy::too_many_lines)]
async fn write_outputs_to_cargo(
	build_dir: &tg::Directory,
	output_directory: &PathBuf,
	externs: &[(String, String)],
) -> tg::Result<()> {
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

	let entries: Vec<_> = build_dir.entries().await?.into_iter().collect();

	let skip_externs = std::env::var("TGRUSTC_TEST_SKIP_EXTERNS").is_ok();
	for (filename, _) in &entries {
		let path = std::path::Path::new(filename);
		let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
		if !skip_externs
			&& matches!(
				ext.to_ascii_lowercase().as_str(),
				"rlib" | "rmeta" | "dylib" | "so"
			) {
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

	let futures = entries.into_iter().map(|(filename, artifact)| {
		let output_directory = output_directory.clone();
		async move {
			let to = output_directory.join(&filename);

			if to.exists() || to.is_symlink() {
				tokio::fs::remove_file(&to).await.ok();
			}

			let file = artifact
				.clone()
				.try_unwrap_file()
				.map_err(|_| tg::error!("expected file artifact for {filename}"))?;
			let bytes = file.bytes().await?;
			tokio::fs::write(&to, &bytes)
				.await
				.map_err(|e| tg::error!(source = e, "failed to write {filename}"))?;

			if !is_dependency_file(&filename) {
				if file.executable().await.unwrap_or(false) {
					let mut perms = tokio::fs::metadata(&to)
						.await
						.map_err(|e| tg::error!(source = e, "failed to stat {filename}"))?
						.permissions();
					std::os::unix::fs::PermissionsExt::set_mode(&mut perms, 0o755);
					tokio::fs::set_permissions(&to, perms)
						.await
						.map_err(|e| tg::error!(source = e, "failed to chmod {filename}"))?;
				}
				// Materialize deps so wrapped executables resolve at runtime.
				let deps = file.dependencies().await?;
				let dep_ids: Vec<tg::artifact::Id> = deps
					.values()
					.filter_map(|dep| {
						let referent = &dep.as_ref()?.0;
						let obj = referent.item.as_ref()?;
						obj.id().try_into().ok()
					})
					.collect();
				if !dep_ids.is_empty() {
					process::batch_checkout(dep_ids).await?;
				}
			}

			// Touch mtime so cargo's fingerprinting treats the output as fresh.
			let now = std::fs::FileTimes::new().set_modified(std::time::SystemTime::now());
			std::fs::File::options()
				.write(true)
				.open(&to)
				.and_then(|f| f.set_times(now))
				.map_err(|e| tg::error!(source = e, "failed to touch {filename}"))?;

			// So process_dependencies can resolve this file without a daemon call.
			process::write_checkin_cache(to.to_str().unwrap_or_default(), &artifact);

			if !is_dependency_file(&filename)
				&& let Some(convenience_name) = strip_metadata_suffix(&filename)
			{
				let convenience_path = output_directory.join(&convenience_name);
				if convenience_path.exists() || convenience_path.is_symlink() {
					tokio::fs::remove_file(&convenience_path).await.ok();
				}
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

			Ok::<_, tg::Error>(())
		}
	});

	futures::future::try_join_all(futures).await?;

	Ok(())
}

/// Extract stem (crate name + metadata hash).
pub(crate) fn extract_stem(filename: &str) -> Option<&str> {
	let stem = Path::new(filename).file_stem()?.to_str()?;
	Some(stem.strip_prefix("lib").unwrap_or(stem))
}

fn is_dependency_file(filename: &str) -> bool {
	Path::new(filename)
		.extension()
		.is_some_and(|ext| matches!(ext.to_str(), Some("rlib" | "rmeta" | "d" | "so" | "dylib")))
}

/// Strip rustc metadata suffix (`-abc123`) and convert underscores to hyphens.
fn strip_metadata_suffix(filename: &str) -> Option<String> {
	let (name, metadata) = filename.rsplit_once('-')?;
	if metadata.is_empty() || !metadata.chars().all(|c| c.is_ascii_hexdigit()) {
		return None;
	}

	Some(name.replace('_', "-"))
}

/// Replace `.rs` files in sibling workspace members with placeholders so the
/// artifact is stable against sibling Rust source changes.
async fn create_filtered_workspace(
	source_dir: &str,
	current_crate_subpath: &str,
) -> tg::Result<tg::Value> {
	let workspace_value = process::content_address_path(source_dir).await?;

	let Some(members) = parse_workspace_members(source_dir) else {
		tracing::warn!("could not parse workspace members, using full workspace source");
		return Ok(workspace_value);
	};

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

	let placeholder_blob = tg::Blob::with_reader(std::io::Cursor::new(b"// placeholder\n")).await?;
	let placeholder_file: tg::Artifact = tg::File::builder(placeholder_blob).build().into();

	let sibling_paths: Vec<&String> = members
		.iter()
		.filter(|m| m.as_str() != current_crate_subpath)
		.collect();

	let member_futures = sibling_paths.iter().map(|member_path| {
		let member_path = (*member_path).clone();
		let workspace_dir = workspace_dir.clone();
		let placeholder_file = placeholder_file.clone();
		async move {
			let member_dir = match workspace_dir.get(&member_path).await {
				Ok(artifact) => match artifact.try_unwrap_directory() {
					Ok(dir) => dir,
					Err(_) => return Ok::<_, tg::Error>(None),
				},
				Err(_) => return Ok(None),
			};
			let filtered =
				replace_rs_files_with_placeholder(&member_dir, &placeholder_file).await?;
			Ok(Some((member_path, filtered)))
		}
	});
	let filtered_members: Vec<Option<(String, tg::Directory)>> =
		futures::future::try_join_all(member_futures).await?;

	let mut builder = workspace_dir.builder().await?;
	for entry in filtered_members.into_iter().flatten() {
		let (member_path, filtered_member) = entry;
		builder = builder
			.add(Path::new(&member_path), filtered_member.into())
			.await?;
	}

	let filtered = builder.build();
	filtered.store().await?;

	tracing::info!(
		?current_crate_subpath,
		filtered_id = ?filtered.id(),
		member_count = members.len(),
		"created filtered workspace for runner"
	);

	Ok(tangram_std::template_from_artifact(filtered.into()).into())
}

async fn replace_rs_files_with_placeholder(
	dir: &tg::Directory,
	placeholder: &tg::Artifact,
) -> tg::Result<tg::Directory> {
	let entries = dir.entries().await?;
	let mut new_entries: BTreeMap<String, tg::Artifact> = BTreeMap::new();
	for (name, artifact) in entries {
		if std::path::Path::new(&name)
			.extension()
			.is_some_and(|ext| ext.eq_ignore_ascii_case("rs"))
		{
			new_entries.insert(name, placeholder.clone());
		} else if let Ok(sub_dir) = artifact.clone().try_unwrap_directory() {
			let filtered =
				Box::pin(replace_rs_files_with_placeholder(&sub_dir, placeholder)).await?;
			new_entries.insert(name, filtered.into());
		} else {
			new_entries.insert(name, artifact);
		}
	}
	Ok(tg::Directory::with_entries(new_entries))
}

/// Reads `[workspace].members` from Cargo.toml, expanding glob patterns.
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
			let member_dir = path.parent()?;
			member_dir
				.strip_prefix(source_dir)
				.ok()?
				.to_str()
				.map(ToOwned::to_owned)
		})
		.collect()
}

fn prepend_to_path(
	env: &mut std::collections::BTreeMap<String, tg::Value>,
	mut prefix: Vec<tg::template::Component>,
) {
	if let Some(tg::Value::Template(existing)) = env.get("PATH") {
		prefix.push(":".to_owned().into());
		prefix.extend(existing.components.iter().cloned());
	}
	env.insert(
		"PATH".to_owned(),
		tg::Template { components: prefix }.into(),
	);
}

/// Per-invocation vars that would invalidate the cache.
fn is_excluded_proxy_env(name: &str) -> bool {
	if name.starts_with("TGRUSTC_") {
		return true;
	}
	if name.starts_with(tg::process::env::PREFIX) {
		return true;
	}
	matches!(
		name,
		"PWD"
			| "OLDPWD"
			| "HOME"
			| "CARGO_HOME"
			| "CARGO_TARGET_DIR"
			| "CARGO_MANIFEST_PATH"
			| "CARGO_MAKEFLAGS"
			| "OUT_DIR"
			| "TARGET_DIR"
			| "RUSTC_WRAPPER"
			| "DYLD_FALLBACK_LIBRARY_PATH"
			| "LD_LIBRARY_PATH"
			// Inner driver uses TGRUSTC_RUSTC; rustup dirs are unused and large.
			| "RUSTUP_HOME"
			| "RUSTUP_TOOLCHAIN"
	)
}

/// Allowlist of rustc-relevant vars; session-specific vars excluded to prevent cache misses.
fn is_allowed_proxy_env(name: &str) -> bool {
	if name.starts_with("CARGO_PKG_")
		|| name.starts_with("CARGO_CFG_")
		|| name.starts_with("CARGO_FEATURE_")
	{
		return true;
	}

	// `DEP_<crate>_<key>` from dependencies' `cargo:metadata=key=value`.
	if name.starts_with("DEP_") {
		return true;
	}

	// Cross-compilation tools: `AR_<triple>`, `CC_<triple>`, `CXX_<triple>`.
	if name.starts_with("AR_") || name.starts_with("CC_") || name.starts_with("CXX_") {
		return true;
	}

	matches!(
		name,
		"CARGO"
			| "CARGO_BUILD_JOBS"
			| "CARGO_CRATE_NAME"
			| "CARGO_BIN_NAME"
			| "CARGO_PRIMARY_PACKAGE"
			| "CARGO_ENCODED_RUSTFLAGS"
			| "CARGO_REGISTRIES_CRATES_IO_PROTOCOL"
			| "CARGO_BUILD_TARGET"
			// RUSTC/RUSTFLAGS still affect cargo-passed flags even though the
			// inner driver gets rustc via TGRUSTC_RUSTC.
			| "RUSTC"
			| "RUSTFLAGS"
			| "RUST_TARGET"
			| "RUST_RECURSION_COUNT"
			| "HOST"
			| "TARGET"
			| "NUM_JOBS"
			| "OPT_LEVEL"
			| "DEBUG"
			| "PROFILE"
			| "MACOSX_DEPLOYMENT_TARGET"
	)
}

/// e.g. `CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER`.
fn is_cargo_target_var(name: &str) -> bool {
	name.starts_with("CARGO_TARGET_") && name.ends_with("_LINKER")
}

fn load_host_env_snapshot() -> Option<HashSet<String>> {
	let path = std::env::var("TGRUSTC_HOST_ENV_SNAPSHOT").ok()?;
	let contents = std::fs::read_to_string(&path).ok()?;
	Some(contents.lines().map(ToOwned::to_owned).collect())
}

/// Build mode (no snapshot) passes all unknown vars through.
fn is_cargo_added_env(name: &str, snapshot: Option<&HashSet<String>>, run_mode: bool) -> bool {
	match snapshot {
		Some(s) => !s.contains(name),
		None => !run_mode,
	}
}

/// Broader allowlist for build scripts (PATH, native lib paths, etc.).
fn is_allowed_runner_env(name: &str) -> bool {
	if name == "PATH" {
		return true;
	}

	if is_allowed_proxy_env(name) || is_cargo_target_var(name) {
		return true;
	}

	if name == "CARGO_MANIFEST_LINKS" || name == "RUSTC_LINKER" {
		return true;
	}

	if name.starts_with("PKG_CONFIG")
		|| name.starts_with("OPENSSL_")
		|| name.starts_with("BINDGEN_")
	{
		return true;
	}

	false
}
