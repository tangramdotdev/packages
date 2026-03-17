use futures::TryStreamExt as _;
use std::{
	os::unix::fs::PermissionsExt as _,
	path::{Path, PathBuf},
	pin::pin,
	sync::LazyLock,
};
use tangram_client::prelude::*;
use tangram_futures::stream::TryExt as _;
use tokio::io::AsyncWriteExt;

/// Result of spawning and waiting for a Tangram process.
pub(crate) struct SpawnResult {
	/// The output directory from the process.
	pub(crate) output: tg::Directory,
	/// The process ID.
	pub(crate) process_id: tg::process::Id,
	/// Whether the result was a cache hit (no token assigned).
	pub(crate) cached: bool,
}

/// Resolve the driver executable from `TGRUSTC_DRIVER_EXECUTABLE` env var or checkin self.
pub(crate) async fn resolve_executable(
	tg: &impl tg::Handle,
) -> tg::Result<tg::command::Executable> {
	if let Ok(path) = std::env::var("TGRUSTC_DRIVER_EXECUTABLE") {
		let (artifact, _) = extract_artifact_from_path(tg, &path).await?;
		Ok(artifact
			.try_unwrap_file()
			.map_err(|_| tg::error!("expected file in TGRUSTC_DRIVER_EXECUTABLE"))?
			.into())
	} else {
		let self_exe = std::env::current_exe()
			.map_err(|e| tg::error!("failed to get current executable: {e}"))?;
		let artifact = tg::checkin(
			tg,
			tg::checkin::Arg {
				options: tg::checkin::Options {
					deterministic: true,
					ignore: false,
					lock: None,
					root: true,
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
}

/// Spawn a Tangram process, wait for completion, and return the output directory.
pub(crate) async fn spawn_and_wait(
	tg: &impl tg::Handle,
	command_ref: tg::Referent<tg::command::Id>,
	description: &str,
) -> tg::Result<SpawnResult> {
	let mut spawn_arg = tg::process::spawn::Arg::with_command(command_ref);
	spawn_arg.network = false;
	spawn_and_wait_with_arg(tg, spawn_arg, description).await
}

/// Spawn a Tangram process with a pre-built spawn arg, wait for completion, and
/// return the output directory.
async fn spawn_and_wait_with_arg(
	tg: &impl tg::Handle,
	spawn_arg: tg::process::spawn::Arg,
	description: &str,
) -> tg::Result<SpawnResult> {
	tracing::info!(%description, "spawning process");

	let stream = tg::Process::spawn(tg, spawn_arg).await?;
	let process = pin!(stream)
		.try_last()
		.await?
		.ok_or_else(|| tg::error!("expected an event"))?
		.try_unwrap_output()
		.ok()
		.ok_or_else(|| tg::error!("expected the output"))?;
	let process_id = process.id().clone();

	tracing::info!(?process_id, %description, "spawned process");

	// Wait for the process output.
	let wait = process.wait(tg, tg::process::wait::Arg::default()).await?;

	if wait.exit != 0 {
		// Try to get stderr from the output.
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
			eprintln!("{description} stderr:\n{stderr_str}");
		}
		eprintln!("{description} failed. View logs with: tangram log {process_id}");
		tracing::error!(exit = wait.exit, ?process_id, %description, "process error details");
		return Err(tg::error!("the process exited with code {}", wait.exit));
	}

	let output = wait.output.unwrap_or(tg::Value::Null);
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

	let cached = process.token().is_none();

	Ok(SpawnResult {
		output,
		process_id,
		cached,
	})
}

/// Read stdout and stderr log files from a process output directory.
pub(crate) async fn read_logs(
	tg: &impl tg::Handle,
	output: &tg::Directory,
) -> tg::Result<(Vec<u8>, Vec<u8>)> {
	futures::future::try_join(
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
	)
	.await
}

/// Forward stdout and stderr bytes to the process output streams.
pub(crate) async fn forward_logs(stdout: &[u8], stderr: &[u8]) -> tg::Result<()> {
	let mut out = tokio::io::stdout();
	out.write_all(stdout)
		.await
		.map_err(|error| tg::error!(source = error, "failed to write stdout"))?;
	out.flush()
		.await
		.map_err(|error| tg::error!(source = error, "failed to flush stdout"))?;
	let mut err = tokio::io::stderr();
	err.write_all(stderr)
		.await
		.map_err(|error| tg::error!(source = error, "failed to write stderr"))?;
	err.flush()
		.await
		.map_err(|error| tg::error!(source = error, "failed to flush stderr"))?;
	Ok(())
}

/// Directory for caching checkin results across proxy invocations. Stored in the
/// cargo target directory so it persists across invocations within a build but is
/// cleared by `cargo clean`. Computed once per process.
///
/// Resolution order:
/// 1. `CARGO_TARGET_DIR` or `TARGET_DIR` env var (explicit target dir).
/// 2. In `tg run` mode, `TGRUSTC_SOURCE_DIR` points to the workspace root, so
///    `<source_dir>/target` is the default cargo target directory.
static CHECKIN_CACHE_DIR: LazyLock<Option<PathBuf>> = LazyLock::new(|| {
	let target_dir = std::env::var("CARGO_TARGET_DIR")
		.or_else(|_| std::env::var("TARGET_DIR"))
		.map(PathBuf::from)
		.ok()
		.or_else(|| {
			let source_dir = std::env::var("TGRUSTC_SOURCE_DIR").ok()?;
			let target = PathBuf::from(source_dir).join("target");
			target.exists().then_some(target)
		})?;
	let dir = target_dir.join(".tgrustc_cache");
	std::fs::create_dir_all(&dir).ok()?;
	Some(dir)
});

/// Try to read a cached artifact ID for a previously checked-in path.
pub(crate) fn read_checkin_cache(path: &str) -> Option<tg::artifact::Id> {
	let cache_dir = CHECKIN_CACHE_DIR.as_ref()?;
	let key = checkin_cache_key(path);
	let contents = std::fs::read_to_string(cache_dir.join(key)).ok()?;
	contents.trim().parse().ok()
}

/// Write a checkin result to the cache. Uses atomic rename for concurrent safety.
pub(crate) fn write_checkin_cache(path: &str, artifact: &tg::Artifact) {
	let Some(cache_dir) = CHECKIN_CACHE_DIR.as_ref() else {
		return;
	};
	let key = checkin_cache_key(path);
	let tmp = cache_dir.join(format!("{key}.{}", std::process::id()));
	if std::fs::write(&tmp, artifact.id().to_string()).is_ok() {
		std::fs::rename(&tmp, cache_dir.join(key)).ok();
	}
}

/// Compute a deterministic cache filename from a path string using FNV-1a.
/// `DefaultHasher` cannot be used here because its seed is randomized per process,
/// producing different keys across proxy invocations.
fn checkin_cache_key(path: &str) -> String {
	use std::hash::{Hash as _, Hasher as _};
	let mut hasher = fnv::FnvHasher::default();
	path.hash(&mut hasher);
	format!("{:016x}", hasher.finish())
}

/// Content-address a path, returning an artifact-based template value.
pub(crate) async fn content_address_path(
	tg: &impl tg::Handle,
	path: &str,
) -> tg::Result<tg::Value> {
	// First, try to unrender the path. This handles artifact-containing paths.
	let template = tangram_std::unrender(path)?;

	// Check if the template contains any artifacts. If so, use it.
	let has_artifacts = template
		.components
		.iter()
		.any(|c| matches!(c, tg::template::Component::Artifact(_)));

	if has_artifacts {
		tracing::trace!(?path, "path contains artifacts, using unrender result");
		return Ok(template.into());
	}

	// The path doesn't contain artifacts. Check it in.
	let path_obj = Path::new(path);
	if path_obj.is_absolute() && path_obj.exists() {
		// Check the file-based cache first. All proxy invocations for the same
		// cargo build share this cache, avoiding redundant checkins of the same
		// path (e.g. FDB_LIB_PATH resolved 697 times).
		if let Some(cached_id) = read_checkin_cache(path) {
			tracing::trace!(?path, "checkin cache hit");
			let artifact = tg::Artifact::with_id(cached_id);
			return Ok(tangram_std::template_from_artifact(artifact).into());
		}

		tracing::trace!(?path, "content-addressing absolute path via checkin");

		let artifact = tg::checkin(
			tg,
			tg::checkin::Arg {
				options: tg::checkin::Options {
					destructive: false,
					deterministic: true,
					ignore: true,
					local_dependencies: false,
					root: true,
					solve: false,
					..Default::default()
				},
				path: path.into(),
				updates: vec![],
			},
		)
		.await?;

		write_checkin_cache(path, &artifact);

		return Ok(tangram_std::template_from_artifact(artifact).into());
	}

	// For relative paths or non-existent paths, return the unrendered template as-is.
	Ok(template.into())
}

/// Extract an artifact from a rendered path containing "/.tangram/artifacts/".
/// Returns the artifact and optional subpath. Navigates into directories if there is a subpath.
pub(crate) async fn extract_artifact_from_path(
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

/// Resolve a path to an artifact. Uses `content_address_path` internally.
pub(crate) async fn resolve_path_to_artifact(
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
		_ => Err(tg::error!("expected artifact in path: {target_path}")),
	}
}

/// Follow a symlink (if present) and resolve the target to an artifact.
pub(crate) async fn follow_and_resolve(
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

/// Batch cache a set of artifacts in a single HTTP call.
pub(crate) async fn batch_cache(
	tg: &impl tg::Handle,
	artifacts: Vec<tg::artifact::Id>,
) -> tg::Result<()> {
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

/// Make a checked-out file writable and set its mtime to now.
///
/// Tangram checkouts are read-only with mtime=0 for reproducibility. Cargo's
/// fingerprinting considers mtime=0 outputs stale, so we add owner-write and
/// update the mtime after checkout.
pub(crate) async fn touch_checkout(
	_tg: &impl tg::Handle,
	target: &Path,
) -> tg::Result<()> {
	let mode = tokio::fs::metadata(target)
		.await
		.map_err(|error| tg::error!(source = error, "failed to stat {}", target.display()))?
		.permissions()
		.mode();
	tokio::fs::set_permissions(target, std::fs::Permissions::from_mode(mode | 0o200))
		.await
		.map_err(|error| tg::error!(source = error, "failed to chmod {}", target.display()))?;
	let now = std::fs::FileTimes::new().set_modified(std::time::SystemTime::now());
	std::fs::File::options()
		.write(true)
		.open(target)
		.and_then(|f| f.set_times(now))
		.map_err(|error| tg::error!(source = error, "failed to touch {}", target.display()))?;
	Ok(())
}
