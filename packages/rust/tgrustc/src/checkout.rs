use {
	std::{
		fs,
		os::unix::fs::PermissionsExt as _,
		path::{Component, Path, PathBuf},
	},
	tangram_client::prelude::*,
};

#[cfg(test)]
mod tests;

// Copy the entries of a cached output to a directory, and return the path of the store on this machine.
pub async fn entries(
	directory: &tg::Directory,
	target: &Path,
	replace: bool,
) -> tg::Result<PathBuf> {
	// Materialize the cached output and its dependencies without changing Cargo's files.
	let arg = tg::checkout::Arg {
		dependencies: true,
		extension: None,
		force: false,
		lock: None,
		nodes: vec![directory.to_referent().map(Into::into)],
		path: None,
	};
	let paths = tg::checkout(arg).await?;
	let source = paths
		.into_iter()
		.next()
		.ok_or_else(|| tg::error!("expected a checkout path"))?;
	let store = source
		.ancestors()
		.find_map(|path| {
			path.file_name()?
				.to_str()?
				.parse::<tg::artifact::Id>()
				.ok()?;
			path.parent().map(Path::to_owned)
		})
		.ok_or_else(|| tg::error!("expected an artifact in the checkout path"))?;

	// Copy the outputs as the invoking user while retaining their dependency metadata.
	let target = target.to_owned();
	let output = tokio::task::spawn_blocking(move || {
		if replace {
			fs::remove_dir_all(&target)
				.map_err(|error| tg::error!(!error, "failed to remove the old output directory"))?;
		}
		copy(&source, &target, &source, &store)?;
		let metadata = target.join(".tangram");
		fs::create_dir_all(&metadata).map_err(|error| {
			tg::error!(!error, "failed to create the output metadata directory")
		})?;
		link(&store, &metadata.join("store"))?;
		Ok::<_, tg::Error>(store)
	})
	.await
	.map_err(|error| tg::error!(!error, "the output copy task panicked"))??;

	Ok(output)
}

fn copy(source: &Path, target: &Path, root: &Path, store: &Path) -> tg::Result<()> {
	let metadata = fs::symlink_metadata(source)
		.map_err(|error| tg::error!(!error, "failed to read the output metadata"))?;
	if metadata.is_dir() {
		if target.is_symlink() {
			fs::remove_file(target)
				.map_err(|error| tg::error!(!error, "failed to remove the old output symlink"))?;
		}
		fs::create_dir_all(target)
			.map_err(|error| tg::error!(!error, "failed to create the output directory"))?;
		let entries = fs::read_dir(source)
			.map_err(|error| tg::error!(!error, "failed to read the output directory"))?;
		for entry in entries {
			let entry =
				entry.map_err(|error| tg::error!(!error, "failed to read an output entry"))?;
			copy(&entry.path(), &target.join(entry.file_name()), root, store)?;
		}
		if let Some(token) = tg::file::xattrs::read_token(source)? {
			tg::file::xattrs::write_token(target, &token)?;
		}
		return Ok(());
	}

	// Preserve relative links within the output and anchor links to other cached artifacts in the store.
	if metadata.is_symlink() {
		let path = fs::read_link(source)
			.map_err(|error| tg::error!(!error, "failed to read the output symlink"))?;
		let path = symlink_target(source, &path, root, store);
		link(&path, target)?;
		#[cfg(target_os = "macos")]
		if let Some(token) = tg::file::xattrs::read_token(source)? {
			tg::file::xattrs::write_token(target, &token)?;
		}
		return Ok(());
	}

	// Replace each file atomically without modifying a cached inode or another compilation's output. Copy only the contents, because Cargo compares the modification times of its outputs, and `fs::copy` preserves the cached file's on macOS.
	let mut temporary = tempfile::NamedTempFile::new_in(parent(target)?)
		.map_err(|error| tg::error!(!error, "failed to create the output temporary file"))?;
	fs::File::open(source)
		.and_then(|mut source| std::io::copy(&mut source, temporary.as_file_mut()))
		.map_err(|error| tg::error!(!error, "failed to copy the output file"))?;
	let permissions = fs::Permissions::from_mode(metadata.permissions().mode() | 0o200);
	fs::set_permissions(temporary.path(), permissions)
		.map_err(|error| tg::error!(!error, "failed to make the output file writable"))?;
	let attributes = tg::file::xattrs::read(source)?;
	let module = tg::file::xattrs::read_module(source)?.map(|module| module.to_string());
	let required = [tg::file::xattrs::Required::Module(
		module.as_deref().map(str::as_bytes),
	)];
	let arg = tg::file::xattrs::Arg {
		dependencies: attributes.dependencies.as_deref(),
		required: &required,
		token: attributes.token.as_ref(),
	};
	tg::file::xattrs::write(temporary.path(), arg, tg::file::xattrs::Options::default())?;
	temporary
		.persist(target)
		.map_err(|error| tg::error!(!error, "failed to install the output file"))?;

	Ok(())
}

fn symlink_target(source: &Path, path: &Path, root: &Path, store: &Path) -> PathBuf {
	let mut resolved = PathBuf::new();
	for component in source.parent().unwrap().join(path).components() {
		match component {
			Component::CurDir => {},
			Component::ParentDir => {
				resolved.pop();
			},
			component => resolved.push(component.as_os_str()),
		}
	}
	if resolved.starts_with(store) && !resolved.starts_with(root) {
		return resolved;
	}

	path.to_owned()
}

fn link(path: &Path, target: &Path) -> tg::Result<()> {
	tempfile::Builder::new()
		.make_in(parent(target)?, |temporary| {
			std::os::unix::fs::symlink(path, temporary)
		})
		.map_err(|error| tg::error!(!error, "failed to create the output symlink"))?
		.into_temp_path()
		.persist(target)
		.map_err(|error| tg::error!(!error, "failed to install the output symlink"))?;

	Ok(())
}

fn parent(target: &Path) -> tg::Result<&Path> {
	target
		.parent()
		.ok_or_else(|| tg::error!("expected an output parent"))
}
