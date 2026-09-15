use std::{
	collections::BTreeMap,
	os::unix::fs::PermissionsExt,
	path::{Path, PathBuf},
};
use tangram_client::prelude::*;
use tokio::io::AsyncWriteExt;

use crate::checkout_artifact;

mod data;
mod resolve;

#[cfg(test)]
mod tests;

/// The working manifest retains Tangram handles until serialization.
pub type Manifest = data::Manifest<tg::Template, tg::Mutation>;
pub type Interpreter = data::Interpreter<tg::Template>;
pub type NormalInterpreter = data::NormalInterpreter<tg::Template>;
pub type LdLinuxInterpreter = data::LdLinuxInterpreter<tg::Template>;
pub type LdMuslInterpreter = data::LdMuslInterpreter<tg::Template>;
pub type DyLdInterpreter = data::DyLdInterpreter<tg::Template>;
pub type Executable = data::Executable<tg::Template>;

impl Manifest {
	/// Read a manifest from the end of the given `[tg::File]`.
	pub async fn read_from_file(file: tg::File) -> tg::Result<Option<Self>> {
		tracing::debug!(?file, "Reading manifest from file");
		let path = checkout_artifact(file.clone().into())
			.await
			.map_err(|error| tg::error!(!error, "failed to check out the file"))?;
		let mut manifest = tokio::task::spawn_blocking(move || Self::read_from_path(path))
			.await
			.map_err(|error| tg::error!(!error, "failed to read the manifest"))?
			.map_err(|error| tg::error!(!error, "failed to read the manifest"))?;
		if let Some(manifest) = &mut manifest {
			manifest.resolve_from_file(&file).await?;
		}
		Ok(manifest)
	}

	/// Read manifest bytes only. Use `read_from_file` or `resolve_from_file` before rebuilding a wrapper.
	pub fn read_from_path(path: impl AsRef<Path>) -> std::io::Result<Option<Self>> {
		let path = path.as_ref();
		tracing::debug!(path = %path.display(), "Reading manifest from path");
		wrap::read_manifest::<data::Data>(path, None)
			.manifest
			.map(Self::try_from_data)
			.transpose()
			.map_err(std::io::Error::other)
	}

	/// Reconnect manifest references to the wrapper's dependency handles.
	pub async fn resolve_from_file(&mut self, file: &tg::File) -> tg::Result<()> {
		let dependencies = file.dependencies().await?;
		let objects = dependencies
			.values()
			.flatten()
			.filter_map(|dependency| dependency.0.node.clone())
			.map(|object| (object.id(), object))
			.collect();
		*self = self.clone().try_map(
			|mut template| {
				resolve::template(&mut template, &objects)?;
				Ok::<_, tg::Error>(template)
			},
			|mut mutation| {
				resolve::mutation(&mut mutation, &objects)?;
				Ok(mutation)
			},
		)?;
		Ok(())
	}

	#[allow(clippy::too_many_lines)]
	pub async fn embed(&self, file: &tg::File) -> tg::Result<tg::File> {
		#[cfg(feature = "tracing")]
		tracing::debug!(?self, "Embedding manifest");

		// Get the paths of the required files.
		let wrapper_exe = std::env::var_os("TANGRAM_WRAPPER_EXE_PATH")
			.map(PathBuf::from)
			.ok_or_else(|| tg::error!("missing wrapper exe"))?;
		let objcopy = std::env::var_os("TANGRAM_OBJCOPY_PATH").map(PathBuf::from);

		// Check out the input file, which is not a dependency of this executable, to get its path on
		// disk.
		let input = checkout_artifact(file.clone().into())
			.await
			.map_err(|error| tg::error!(!error, "failed to check out the input file"))?;

		// Provide the context to wrap.
		wrap::set_wrapper_exe_path(wrapper_exe);
		if let Some(objcopy) = objcopy {
			wrap::set_objcopy_path(objcopy);
		}

		// Copy the input file to a a temp.
		let tempfile = tempfile::NamedTempFile::new()
			.map_err(|error| tg::error!(!error, "failed to create temp file"))?;
		tokio::fs::copy(&input, tempfile.path())
			.await
			.map_err(|error| tg::error!(!error, "failed to copy file"))?;
		tokio::fs::set_permissions(tempfile.path(), std::fs::Permissions::from_mode(0o755))
			.await
			.map_err(|error| tg::error!(!error, "failed to set permissions"))?;

		// Embed the wrapper.
		tokio::task::spawn_blocking({
			let manifest = self.to_data();
			let output = tempfile.path().to_owned();
			move || wrap::embed(output, &manifest, None)
		})
		.await
		.map_err(|error| tg::error!(!error, "failed to wrap the binary"))?
		.map_err(
			|error| tg::error!(!error, path = %tempfile.path().display(), "failed to wrap the binary"),
		)?;

		// Codesign if necessary.
		if matches!(
			wrap::detect_format(tempfile.path()),
			Ok(Some(wrap::Format::Mach64))
		) {
			tracing::info!("codesigning binary");
			let codesign = std::env::var_os("TANGRAM_CODESIGN_PATH")
				.ok_or_else(|| tg::error!("missing the codesign binary"))?;
			let output = tokio::process::Command::new(codesign)
				.arg("sign")
				.arg(tempfile.path())
				.stdout(std::process::Stdio::piped())
				.stderr(std::process::Stdio::piped())
				.output()
				.await
				.map_err(|error| tg::error!(!error, "codesign command failed"))?;
			if !output.status.success() {
				tokio::io::stderr().write_all(&output.stderr).await.ok();
				return Err(tg::error!("codesign command failed"));
			}
		}

		// Create the blob.
		let reader = tokio::fs::File::open(tempfile.path())
			.await
			.map_err(|error| tg::error!(!error, "failed to open the file"))?;
		let blob = tg::Blob::with_reader(reader)
			.await
			.map_err(|error| tg::error!(!error, "failed to create blob"))?;

		// Obtain the dependencies from the manifest to add to the file.
		// NOTE: We know the wrapper file has no dependencies, so there is no need to merge.
		let dependencies = self.dependencies();
		let dependencies = if dependencies.is_empty() {
			None
		} else {
			Some(dependencies)
		};

		// Create a file with the new blob and references.
		let mut output_file = tg::File::builder().contents(blob).executable(true);
		if let Some(dependencies) = dependencies {
			output_file = output_file.dependencies(dependencies);
		}
		let output_file = output_file
			.build()
			.map_err(|error| tg::error!(!error, "failed to build wrapper file"))?;

		#[cfg(feature = "tracing")]
		{
			let file_id = output_file.id();
			tracing::trace!(?file_id, "created wrapper file");
		}

		Ok(output_file)
	}

	pub fn write_to_path(&self, path: &Path) {
		let manifest = self.to_data();
		wrap::write_manifest(path, &manifest, None);
	}

	fn for_each_template(&self, mut visit: impl FnMut(&tg::Template)) {
		fn visit_all(templates: Option<&[tg::Template]>, visit: &mut impl FnMut(&tg::Template)) {
			for template in templates.into_iter().flatten() {
				visit(template);
			}
		}
		visit_all(self.args.as_deref(), &mut visit);
		match &self.executable {
			Executable::Address(_) => {},
			Executable::Content(template) | Executable::Path(template) => visit(template),
		}
		match &self.interpreter {
			Some(Interpreter::DyLd(interpreter)) => {
				visit_all(interpreter.library_paths.as_deref(), &mut visit);
				visit_all(interpreter.preloads.as_deref(), &mut visit);
			},
			Some(Interpreter::LdLinux(interpreter)) => {
				visit(&interpreter.path);
				visit_all(interpreter.args.as_deref(), &mut visit);
				visit_all(interpreter.library_paths.as_deref(), &mut visit);
				visit_all(interpreter.preloads.as_deref(), &mut visit);
			},
			Some(Interpreter::LdMusl(interpreter)) => {
				visit(&interpreter.path);
				visit_all(interpreter.args.as_deref(), &mut visit);
				visit_all(interpreter.library_paths.as_deref(), &mut visit);
				visit_all(interpreter.preloads.as_deref(), &mut visit);
			},
			Some(Interpreter::Normal(interpreter)) => {
				visit(&interpreter.path);
				for arg in &interpreter.args {
					visit(arg);
				}
			},
			None => {},
		}
	}

	/// Create a new wrapper from a manifest. Will locate the wrapper file from the `TANGRAM_WRAPPER_EXE_PATH` environment variable.
	pub async fn write(&self) -> tg::Result<tg::File> {
		tracing::debug!(?self, "Writing manifest");

		// Get the path of the wrapper file.
		let path = std::env::var_os("TANGRAM_WRAPPER_EXE_PATH")
			.ok_or_else(|| tg::error!("missing wrapper exe"))?;

		// Create a temp.
		let temp = tempfile::NamedTempFile::new()
			.map_err(|error| tg::error!(!error, "failed to create temp file"))?;

		// Copy the wrapper to a temp.
		tokio::fs::copy(&path, temp.path())
			.await
			.map_err(|error| tg::error!(!error, "failed to copy the file"))?;
		tokio::fs::set_permissions(temp.path(), std::fs::Permissions::from_mode(0o755))
			.await
			.map_err(|error| tg::error!(!error, "failed to set permissions"))?;

		// Append the manifest to the temp.
		let path = temp.path().to_owned();
		let manifest = self.clone();
		tokio::task::spawn_blocking({
			let path = path.clone();
			move || manifest.write_to_path(&path)
		})
		.await
		.map_err(|error| tg::error!(!error, "failed to write manifest to file"))?;

		// Codesign if necessary.
		if matches!(wrap::detect_format(&path), Ok(Some(wrap::Format::Mach64))) {
			tracing::info!("codesigning binary");
			let codesign = std::env::var_os("TANGRAM_CODESIGN_PATH")
				.ok_or_else(|| tg::error!("missing the codesign binary"))?;
			let output = tokio::process::Command::new(codesign)
				.arg("sign")
				.arg(temp.path())
				.stdout(std::process::Stdio::piped())
				.stderr(std::process::Stdio::piped())
				.output()
				.await
				.map_err(|error| tg::error!(!error, "codesign command failed"))?;
			if !output.status.success() {
				tokio::io::stderr().write_all(&output.stderr).await.ok();
				return Err(tg::error!("codesign command failed"));
			}
		}

		// Check the temp in.
		let output = tg::checkin(tg::checkin::Arg {
			options: tg::checkin::Options {
				root: true,
				..tg::checkin::Options::default()
			},
			path: temp.path().to_owned(),
			updates: Vec::new(),
		})
		.await
		.map_err(|error| tg::error!(!error, "failed to check in file"))?;
		let wrapped = tg::Artifact::with_referent(output.artifact)
			.try_unwrap_file()
			.map_err(|_| tg::error!("expected a file"))?;

		// Obtain the dependencies from the manifest to add to the file.
		// NOTE: We know the wrapper file has no dependencies, so there is no need to merge.
		let dependencies = self.dependencies();

		// Create a file with the new blob and references.
		let contents = wrapped
			.contents()
			.await
			.map_err(|error| tg::error!(!error, "failed to get the file contents"))?;
		let mut builder = tg::File::builder().contents(contents).executable(true);
		if !dependencies.is_empty() {
			builder = builder.dependencies(dependencies);
		}

		// Create the file.
		let output_file = builder
			.build()
			.map_err(|error| tg::error!(!error, "failed to build wrapper file"))?;
		tracing::trace!(file = %output_file.id(), "created wrapper file");

		// Return the output file.
		Ok(output_file)
	}

	/// Collect dependency handles from every manifest field.
	#[must_use]
	pub fn dependencies(&self) -> BTreeMap<tg::Reference, Option<tg::file::Dependency>> {
		let mut objects = Vec::new();
		self.for_each_template(|template| objects.extend(template.objects()));
		if let Some(env) = &self.env {
			objects.extend(env.objects());
		}
		let mut dependencies = BTreeMap::new();
		for object in objects {
			dependencies
				.entry(tg::Reference::with_object(object.id()))
				.or_insert_with(|| {
					Some(tg::file::Dependency(tg::Referent::with_node(Some(object))))
				});
		}
		dependencies
	}
}
