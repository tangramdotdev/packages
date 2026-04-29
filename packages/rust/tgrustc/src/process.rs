use std::{
	path::{Path, PathBuf},
	sync::LazyLock,
};
use tangram_client::prelude::*;
use tokio::io::AsyncWriteExt;

pub(crate) struct SpawnResult {
	pub(crate) output: tg::Directory,
	pub(crate) process_id: tg::process::Id,
	/// Cache hit (no token assigned).
	pub(crate) cached: bool,
}

/// Resolve the driver from `TGRUSTC_DRIVER_EXECUTABLE` or check in self.
pub(crate) async fn resolve_executable() -> tg::Result<tg::command::Executable> {
	if let Ok(path) = std::env::var("TGRUSTC_DRIVER_EXECUTABLE") {
		let (artifact, _) = extract_artifact_from_path(&path).await?;
		Ok(artifact
			.try_unwrap_file()
			.map_err(|_| tg::error!("expected file in TGRUSTC_DRIVER_EXECUTABLE"))?
			.into())
	} else {
		let self_exe = std::env::current_exe()
			.map_err(|e| tg::error!("failed to get current executable: {e}"))?;
		let artifact = tg::checkin(tg::checkin::Arg {
			options: tg::checkin::Options {
				deterministic: true,
				ignore: false,
				lock: None,
				root: true,
				..Default::default()
			},
			path: self_exe,
			updates: vec![],
		})
		.await?;
		Ok(artifact
			.try_unwrap_file()
			.map_err(|_| tg::error!("expected file from tgrustc checkin"))?
			.into())
	}
}

pub(crate) async fn spawn_and_wait(
	executable: tg::command::Executable,
	args: Vec<tg::Value>,
	env: tg::value::Map,
	host: String,
	name: String,
	description: &str,
) -> tg::Result<SpawnResult> {
	let arg = tg::process::Arg {
		args,
		env,
		executable: Some(executable),
		host: Some(host),
		name: Some(name),
		sandbox: Some(tg::Either::Left(tg::sandbox::create::Arg::default())),
		stderr: tg::process::Stdio::Log,
		stdin: tg::process::Stdio::Null,
		stdout: tg::process::Stdio::Log,
		..Default::default()
	};
	spawn_and_wait_with_arg(arg, description).await
}

async fn spawn_and_wait_with_arg(
	arg: tg::process::Arg,
	description: &str,
) -> tg::Result<SpawnResult> {
	tracing::info!(%description, "spawning process");

	let process: tg::Process = tg::Process::spawn(arg).await?;
	let process_id = process.id().unwrap_right().clone();

	tracing::info!(?process_id, %description, "spawned process");

	let wait = process.wait(tg::process::wait::Arg::default()).await?;

	if wait.exit != 0 {
		let stderr_bytes: Option<Vec<u8>> = async {
			let output_obj = wait.output.as_ref()?.clone().try_unwrap_object().ok()?;
			let output_dir = output_obj.try_unwrap_directory().ok()?;
			let stderr_file = output_dir
				.get("log/stderr")
				.await
				.ok()?
				.try_unwrap_file()
				.ok()?;
			let bytes = stderr_file.contents().await.ok()?.bytes().await.ok()?;
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

pub(crate) async fn read_logs(output: &tg::Directory) -> tg::Result<(Vec<u8>, Vec<u8>)> {
	futures::future::try_join(
		async {
			output
				.get(&"log/stdout")
				.await?
				.try_unwrap_file()
				.unwrap()
				.contents()
				.await?
				.bytes()
				.await
		},
		async {
			output
				.get(&"log/stderr")
				.await?
				.try_unwrap_file()
				.unwrap()
				.contents()
				.await?
				.bytes()
				.await
		},
	)
	.await
}

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

/// In `$TMPDIR` so atomic-rename temp files don't race with `tg::checkin` walks of `target/`.
static CHECKIN_CACHE_DIR: LazyLock<Option<PathBuf>> = LazyLock::new(|| {
	if std::env::var("TGRUSTC_DISABLE_CHECKIN_CACHE").is_ok() {
		return None;
	}
	let target_dir = std::env::var("CARGO_TARGET_DIR")
		.or_else(|_| std::env::var("TARGET_DIR"))
		.map(PathBuf::from)
		.ok()
		.or_else(|| {
			let source_dir = std::env::var("TGRUSTC_SOURCE_DIR").ok()?;
			let target = PathBuf::from(source_dir).join("target");
			target.exists().then_some(target)
		})?;
	let key = checkin_cache_key(&target_dir.to_string_lossy());
	let dir = std::env::temp_dir().join(format!("tgrustc-cache-{key}"));
	std::fs::create_dir_all(&dir).ok()?;
	Some(dir)
});

pub(crate) fn read_checkin_cache(path: &str) -> Option<tg::artifact::Id> {
	let cache_dir = CHECKIN_CACHE_DIR.as_ref()?;
	let key = checkin_cache_key(path);
	let contents = std::fs::read_to_string(cache_dir.join(key)).ok()?;
	contents.trim().parse().ok()
}

/// Atomic rename for concurrent safety.
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

/// FNV-1a (not `DefaultHasher`, which is randomized per process).
fn checkin_cache_key(path: &str) -> String {
	use std::hash::{Hash as _, Hasher as _};
	let mut hasher = fnv::FnvHasher::default();
	path.hash(&mut hasher);
	format!("{:016x}", hasher.finish())
}

pub(crate) fn is_artifact_path(path: &str) -> bool {
	path.contains("/.tangram/artifacts/") || path.contains("/opt/tangram/artifacts/")
}

pub(crate) async fn content_address_path(path: &str) -> tg::Result<tg::Value> {
	let template = tangram_std::unrender(path)?;

	let has_artifacts = template
		.components
		.iter()
		.any(|c| matches!(c, tg::template::Component::Artifact(_)));

	if has_artifacts {
		tracing::trace!(?path, "path contains artifacts, using unrender result");
		return Ok(template.into());
	}

	let path_obj = Path::new(path);
	if path_obj.is_absolute() && path_obj.exists() {
		if let Some(cached_id) = read_checkin_cache(path) {
			tracing::trace!(?path, "checkin cache hit");
			let artifact = tg::Artifact::with_id(cached_id);
			return Ok(tangram_std::template_from_artifact(artifact).into());
		}

		tracing::trace!(?path, "content-addressing absolute path via checkin");

		let artifact = tg::checkin(tg::checkin::Arg {
			options: tg::checkin::Options {
				destructive: false,
				deterministic: true,
				ignore: true,
				source_dependencies: false,
				root: true,
				solve: false,
				..Default::default()
			},
			path: path.into(),
			updates: vec![],
		})
		.await?;

		write_checkin_cache(path, &artifact);

		return Ok(tangram_std::template_from_artifact(artifact).into());
	}

	Ok(template.into())
}

/// Returns the artifact and optional subpath, navigating into directories when a subpath is present.
pub(crate) async fn extract_artifact_from_path(
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
		let inner = dir.get(subpath).await?;
		Ok((inner, Some(subpath.trim_end_matches('/').to_owned())))
	} else {
		Ok((artifact, None))
	}
}

pub(crate) async fn resolve_path_to_artifact(target_path: &str) -> tg::Result<tg::Artifact> {
	let value = content_address_path(target_path).await?;

	match value {
		tg::Value::Template(template) => template
			.components
			.into_iter()
			.find_map(|c| c.try_unwrap_artifact().ok())
			.ok_or_else(|| tg::error!("expected artifact in path: {target_path}")),
		_ => Err(tg::error!("expected artifact in path: {target_path}")),
	}
}

pub(crate) async fn follow_and_resolve(path: &str) -> tg::Result<tg::Artifact> {
	let file_path = PathBuf::from(path);
	let target = if file_path.is_symlink() {
		std::fs::read_link(&file_path)
			.ok()
			.and_then(|t| t.to_str().map(ToOwned::to_owned))
			.unwrap_or_else(|| path.to_owned())
	} else {
		path.to_owned()
	};
	resolve_path_to_artifact(&target).await
}

pub(crate) async fn batch_checkout(artifacts: Vec<tg::artifact::Id>) -> tg::Result<()> {
	futures::future::try_join_all(artifacts.into_iter().map(|artifact| {
		tg::checkout::checkout(tg::checkout::Arg {
			artifact,
			dependencies: false,
			extension: None,
			force: false,
			lock: None,
			path: None,
		})
	}))
	.await?;
	Ok(())
}
