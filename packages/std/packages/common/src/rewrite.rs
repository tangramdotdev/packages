use {
	crate::{Manifest, manifest},
	std::{fs::Permissions, os::unix::fs::PermissionsExt as _, path::Path, time::SystemTime},
	tangram_client::prelude::*,
};

/// Run a tool on a copy of a wrapper's executable, then replace the wrapper with one that wraps the tool's output.
#[allow(clippy::too_many_lines)]
pub async fn wrapper(
	path: &Path,
	mut manifest: Manifest,
	run: impl FnOnce(&Path) -> tg::Result<()>,
) -> tg::Result<()> {
	// Validate the manifest.
	if !matches!(&manifest.executable, manifest::Executable::Path(_)) {
		return Err(tg::error!("expected a wrapper with an executable path"));
	}

	// The bytes contain IDs only. Recover the wrapper's authorized dependencies before rebuilding it.
	let absolute_path =
		std::path::absolute(path).map_err(|error| tg::error!(!error, "invalid wrapper path"))?;
	let output = tg::checkin(tg::checkin::Arg {
		options: tg::checkin::Options {
			destructive: false,
			deterministic: true,
			ignore: false,
			lock: None,
			root: true,
			..tg::checkin::Options::default()
		},
		path: absolute_path,
		updates: Vec::new(),
	})
	.await?;
	let file = tg::Artifact::with_referent(output.artifact)
		.try_unwrap_file()
		.map_err(|error| tg::error!(!error, "expected a wrapper file"))?;
	manifest.resolve_from_file(&file).await?;
	let manifest::Executable::Path(artifact_path) = &manifest.executable else {
		return Err(tg::error!("expected a wrapper with an executable path"));
	};
	let original_metadata = tokio::fs::metadata(path)
		.await
		.map_err(|error| tg::error!(!error, "failed to read the wrapper metadata"))?;
	#[cfg(feature = "tracing")]
	tracing::info!(?artifact_path, "found executable artifact path");

	// Get the path to the actual executable.
	let executable_path = artifact_path
		.try_render(|component| async move {
			match component {
				tg::template::Component::String(string) => Ok(string.clone()),
				tg::template::Component::Artifact(artifact) => {
					crate::checkout_artifact(artifact.clone())
						.await?
						.into_os_string()
						.into_string()
						.map_err(|_| tg::error!("checkout path is not UTF-8"))
				},
				tg::template::Component::Placeholder(_) => {
					Err(tg::error!("cannot render an unresolved placeholder"))
				},
			}
		})
		.await
		.map(std::path::PathBuf::from)
		.map_err(|error| tg::error!(!error, ?artifact_path, "unable to render executable path"))?;
	#[cfg(feature = "tracing")]
	tracing::info!(?executable_path, "found executable path");

	// Copy the file to a temp directory.
	#[cfg(target_os = "linux")]
	let tmpdir = tempfile::TempDir::new_in("/")
		.map_err(|error| tg::error!(!error, "failed to create tempdir"))?;
	#[cfg(target_os = "macos")]
	let tmpdir =
		tempfile::TempDir::new().map_err(|error| tg::error!(!error, "failed to create tempdir"))?;
	let tmp_path = tmpdir.path();
	let local_executable_path = tmp_path.join("executable");
	#[cfg(feature = "tracing")]
	tracing::info!(?local_executable_path, "copying the executable");
	tokio::fs::copy(&executable_path, &local_executable_path)
		.await
		.map_err(|error| tg::error!(source = error, "failed to copy the executable"))?;

	// Set the file to be writable.
	let mut perms = tokio::fs::metadata(&local_executable_path)
		.await
		.map_err(|error| tg::error!(!error, path = %local_executable_path.display(), "failed to get the file metadata"))?
		.permissions();
	perms.set_mode(perms.mode() | 0o200);
	tokio::fs::set_permissions(&local_executable_path, perms)
		.await
		.map_err(|error| tg::error!(!error, path = %local_executable_path.display(), "failed to set file permissions"))?;

	// Give date-preserving tools the wrapper's modification time instead of the store's epoch.
	let wrapper_modified = original_metadata
		.modified()
		.map_err(|error| tg::error!(!error, "failed to read the wrapper modification time"))?;
	std::fs::File::open(&local_executable_path)
		.and_then(|file| file.set_modified(wrapper_modified))
		.map_err(|error| tg::error!(!error, "failed to set the tool input modification time"))?;

	// Run the tool on the executable.
	run(&local_executable_path)?;

	// Preserve the tool output's modification time before check-in and wrapping.
	let modified = std::fs::metadata(&local_executable_path)
		.and_then(|metadata| metadata.modified())
		.map_err(|error| tg::error!(!error, "failed to read the tool output modification time"))?;

	// Check in the result.
	let output = tg::checkin(tg::checkin::Arg {
		options: tg::checkin::Options {
			source_dependencies: true,
			destructive: false,
			deterministic: true,
			ignore: false,
			locked: false,
			lock: Some(tg::checkin::Lock::Attr),
			root: true,
			..tg::checkin::Options::default()
		},
		path: local_executable_path,
		updates: vec![],
	})
	.await?;
	let executable = tg::Artifact::with_referent(output.artifact)
		.try_unwrap_file()
		.map_err(|error| tg::error!(source = error, "expected a file"))?;
	#[cfg(feature = "tracing")]
	tracing::info!(executable_id = ?executable.id(), "checked in the executable");
	#[cfg(feature = "tracing")]
	if let Err(e) = tmpdir.close() {
		tracing::warn!(?e, "failed to close tempdir");
	}
	#[cfg(not(feature = "tracing"))]
	let _ = tmpdir.close();

	// Produce a new manifest with the new executable, and the rest of the manifest unchanged.
	let new_manifest = Manifest {
		executable: manifest::Executable::Path(crate::template_from_artifact(executable.into())),
		..manifest
	};
	#[cfg(feature = "tracing")]
	tracing::info!(?new_manifest, "created new manifest");
	let new_wrapper = new_manifest.write().await?;
	new_wrapper.store().await?;
	#[cfg(feature = "tracing")]
	{
		let new_wrapper_id = new_wrapper.id();
		tracing::info!(?new_wrapper_id, "wrote new wrapper");
	}

	// Replace the wrapper.
	replace(
		path,
		new_wrapper.into(),
		original_metadata.permissions(),
		modified,
	)
	.await?;

	Ok(())
}

/// Run a tool that rewrites a file in place, then restore the dependencies that the rewrite discarded.
pub async fn file(path: &Path, run: impl FnOnce() -> tg::Result<()>) -> tg::Result<()> {
	// Run the tool directly if the file has no dependencies.
	let dependencies = tg::file::xattrs::read_dependencies(path)?;
	if dependencies.is_none_or(|dependencies| dependencies.is_empty()) {
		return run();
	}

	// Check in the original file to recover its authorized dependencies.
	let original = checkin_file(path).await?;
	let dependencies = original.dependencies().await?;
	let permissions = tokio::fs::metadata(path)
		.await
		.map_err(|error| tg::error!(!error, "failed to read the file metadata"))?
		.permissions();
	#[cfg(feature = "tracing")]
	tracing::info!(?path, ?dependencies, "recovered the file dependencies");

	// Run the tool.
	run()?;

	// Check in the output and rebuild it with the original dependencies.
	let modified = std::fs::metadata(path)
		.and_then(|metadata| metadata.modified())
		.map_err(|error| tg::error!(!error, "failed to read the tool output modification time"))?;
	let output = checkin_file(path).await?;
	let contents = output.contents().await?;
	let executable = output.executable().await?;
	let file = tg::File::builder()
		.contents(contents)
		.executable(executable)
		.dependencies(dependencies)
		.build()
		.map_err(|error| tg::error!(!error, "failed to build the output file"))?;
	file.store().await?;
	#[cfg(feature = "tracing")]
	tracing::info!(file_id = ?file.id(), "rebuilt the file with its dependencies");

	// Replace the file.
	replace(path, file.into(), permissions, modified).await?;

	Ok(())
}

/// Check in a file without writing to it.
async fn checkin_file(path: &Path) -> tg::Result<tg::File> {
	let path =
		std::path::absolute(path).map_err(|error| tg::error!(!error, "invalid file path"))?;
	let output = tg::checkin(tg::checkin::Arg {
		options: tg::checkin::Options {
			destructive: false,
			deterministic: true,
			ignore: false,
			source_dependencies: true,
			locked: false,
			lock: None,
			root: true,
			..tg::checkin::Options::default()
		},
		path,
		updates: vec![],
	})
	.await?;
	let file = tg::Artifact::with_referent(output.artifact)
		.try_unwrap_file()
		.map_err(|error| tg::error!(source = error, "expected a file"))?;
	Ok(file)
}

/// Check out an artifact in place of a file, then restore the file's permissions and modification time.
async fn replace(
	path: &Path,
	artifact: tg::Artifact,
	permissions: Permissions,
	modified: SystemTime,
) -> tg::Result<()> {
	// Remove the existing file.
	let path = std::fs::canonicalize(path).map_err(|error| {
		tg::error!(
			source = error,
			"could not get canonical path for the output file"
		)
	})?;
	#[cfg(feature = "tracing")]
	tracing::info!(?path, "checking out the new output file");
	tokio::fs::remove_file(&path)
		.await
		.map_err(|error| tg::error!(source = error, "failed to remove the output file"))?;

	// Check out the artifact.
	crate::checkout_artifact_to_path(artifact, path.clone()).await?;

	// Restore the permissions first so the file can be opened to set its modification time.
	tokio::fs::set_permissions(&path, permissions)
		.await
		.map_err(|error| tg::error!(!error, "failed to restore the output permissions"))?;
	std::fs::File::open(&path)
		.and_then(|file| file.set_modified(modified))
		.map_err(|error| tg::error!(!error, "failed to restore the output modification time"))?;
	#[cfg(feature = "tracing")]
	tracing::info!("checked out the new output file");

	Ok(())
}
