use std::{
	collections::BTreeMap,
	os::unix::fs::PermissionsExt,
	path::{Path, PathBuf},
	sync::LazyLock,
};
use tangram_client::prelude::*;
use tokio::io::AsyncWriteExt;

use crate::checkout_artifact;

#[cfg(test)]
mod tests;

/// The Tangram run entrypoint manifest.
#[derive(
	Clone,
	Debug,
	serde::Serialize,
	serde::Deserialize,
	tangram_serialize::Serialize,
	tangram_serialize::Deserialize,
)]
pub struct Manifest {
	/// The interpreter for the executable.
	#[serde(skip_serializing_if = "Option::is_none")]
	#[tangram_serialize(id = 0, skip_serializing_if = "Option::is_none")]
	pub interpreter: Option<Interpreter>,

	/// The executable to run.
	#[tangram_serialize(id = 1)]
	pub executable: Executable,

	/// The environment variable mutations to apply.
	#[serde(skip_serializing_if = "Option::is_none")]
	#[tangram_serialize(id = 2, skip_serializing_if = "Option::is_none")]
	pub env: Option<tg::mutation::Data>,

	/// The command line arguments to pass to the executable.
	#[serde(skip_serializing_if = "Option::is_none")]
	#[tangram_serialize(id = 3, skip_serializing_if = "Option::is_none")]
	pub args: Option<Vec<tg::template::Data>>,
}

/// An interpreter is another program that is used to launch the executable.
#[derive(
	Clone,
	Debug,
	serde::Serialize,
	serde::Deserialize,
	tangram_serialize::Serialize,
	tangram_serialize::Deserialize,
)]
#[serde(tag = "kind")]
pub enum Interpreter {
	/// A normal interpreter.
	#[serde(rename = "normal")]
	#[tangram_serialize(id = 0)]
	Normal(NormalInterpreter),

	/// An ld-linux interpreter.
	#[serde(rename = "ld-linux")]
	#[tangram_serialize(id = 1)]
	LdLinux(LdLinuxInterpreter),

	/// An ld-musl interpreter.
	#[serde(rename = "ld-musl")]
	#[tangram_serialize(id = 2)]
	LdMusl(LdMuslInterpreter),

	// A dyld interpreter.
	#[serde(rename = "dyld")]
	#[tangram_serialize(id = 3)]
	DyLd(DyLdInterpreter),
}

impl Interpreter {
	#[must_use]
	pub fn is_dynamic(&self) -> bool {
		matches!(
			self,
			Interpreter::LdLinux(_) | Interpreter::LdMusl(_) | Interpreter::DyLd(_)
		)
	}
}

#[derive(
	Clone,
	Debug,
	serde::Serialize,
	serde::Deserialize,
	tangram_serialize::Serialize,
	tangram_serialize::Deserialize,
)]
pub struct NormalInterpreter {
	/// The path to the file to exec.
	#[tangram_serialize(id = 0)]
	pub path: tg::template::Data,

	/// Arguments for the interpreter.
	#[tangram_serialize(id = 1)]
	pub args: Vec<tg::template::Data>,
}

#[derive(
	Clone,
	Debug,
	serde::Serialize,
	serde::Deserialize,
	tangram_serialize::Serialize,
	tangram_serialize::Deserialize,
)]
#[serde(rename_all = "camelCase")]
pub struct LdLinuxInterpreter {
	/// The path to ld-linux.so.
	#[tangram_serialize(id = 0)]
	pub path: tg::template::Data,

	/// The paths for the `--library-path` argument.
	#[serde(skip_serializing_if = "Option::is_none")]
	#[tangram_serialize(id = 1, skip_serializing_if = "Option::is_none")]
	pub library_paths: Option<Vec<tg::template::Data>>,

	/// The paths for the `--preload` argument.
	#[serde(skip_serializing_if = "Option::is_none")]
	#[tangram_serialize(id = 2, skip_serializing_if = "Option::is_none")]
	pub preloads: Option<Vec<tg::template::Data>>,

	/// Any additional arguments.
	#[serde(skip_serializing_if = "Option::is_none")]
	#[tangram_serialize(id = 3, skip_serializing_if = "Option::is_none")]
	pub args: Option<Vec<tg::template::Data>>,
}

#[derive(
	Clone,
	Debug,
	serde::Serialize,
	serde::Deserialize,
	tangram_serialize::Serialize,
	tangram_serialize::Deserialize,
)]
#[serde(rename_all = "camelCase")]
pub struct LdMuslInterpreter {
	/// The path to ld-linux.so.
	#[tangram_serialize(id = 0)]
	pub path: tg::template::Data,

	/// The paths for the `--library-path` argument.
	#[serde(skip_serializing_if = "Option::is_none")]
	#[tangram_serialize(id = 1, skip_serializing_if = "Option::is_none")]
	pub library_paths: Option<Vec<tg::template::Data>>,

	/// The paths for the `--preload` argument.
	#[serde(skip_serializing_if = "Option::is_none")]
	#[tangram_serialize(id = 2, skip_serializing_if = "Option::is_none")]
	pub preloads: Option<Vec<tg::template::Data>>,

	/// Any additional arguments.
	#[serde(skip_serializing_if = "Option::is_none")]
	#[tangram_serialize(id = 3, skip_serializing_if = "Option::is_none")]
	pub args: Option<Vec<tg::template::Data>>,
}

#[derive(
	Clone,
	Debug,
	serde::Serialize,
	serde::Deserialize,
	tangram_serialize::Serialize,
	tangram_serialize::Deserialize,
)]
#[serde(rename_all = "camelCase")]
pub struct DyLdInterpreter {
	/// The paths for the `DYLD_LIBRARY_PATH` environment variable.
	#[serde(skip_serializing_if = "Option::is_none")]
	#[tangram_serialize(id = 0, skip_serializing_if = "Option::is_none")]
	pub library_paths: Option<Vec<tg::template::Data>>,

	/// The paths for the `DYLD_INSERT_LIBRARIES` environment variable.
	#[serde(skip_serializing_if = "Option::is_none")]
	#[tangram_serialize(id = 1, skip_serializing_if = "Option::is_none")]
	pub preloads: Option<Vec<tg::template::Data>>,
}

/// An executable launched by the entrypoint.
#[derive(
	Clone,
	Debug,
	serde::Serialize,
	serde::Deserialize,
	tangram_serialize::Serialize,
	tangram_serialize::Deserialize,
)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
pub enum Executable {
	/// A path to an executable file.
	#[tangram_serialize(id = 0)]
	Path(tg::template::Data),

	/// A script which will be rendered to a file and interpreted.
	#[tangram_serialize(id = 1)]
	Content(tg::template::Data),

	/// A virtual address.
	#[tangram_serialize(id = 2)]
	Address(u64),
}

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
			manifest.inherit_from_file(&file).await?;
		}
		Ok(manifest)
	}

	/// Read manifest bytes only. Use `read_from_file` or `inherit_from_file` before rebuilding a wrapper.
	pub fn read_from_path(path: impl AsRef<Path>) -> std::io::Result<Option<Self>> {
		let path = path.as_ref();
		tracing::debug!(path = %path.display(), "Reading manifest from path");
		Ok(wrap::read_manifest(path, None).manifest)
	}

	/// Restore authorization from the wrapper's dependency handles and tokens.
	pub async fn inherit_from_file(&mut self, file: &tg::File) -> tg::Result<()> {
		let dependencies = file.dependencies().await?;
		let mut references = BTreeMap::new();
		for dependency in dependencies.values().flatten() {
			if let Some(object) = &dependency.0.node {
				insert_dependency(&mut references, object.clone());
			}
		}
		let parent = file.to_referent().options;
		let mut restore = |id: &tg::object::Id, options: &mut tg::referent::Options| {
			let reference = tg::Reference::with_object(id.clone());
			let source = references
				.get(&reference)
				.and_then(Option::as_ref)
				.and_then(|dependency| dependency.0.node.as_ref())
				.map_or_else(|| parent.clone(), |object| object.to_referent().options);
			options.location = options.location.take().or(source.location);
			options.tokens.inherit(&source.tokens);
		};
		self.for_each_reference_mut(&mut restore);
		Ok(())
	}

	#[allow(clippy::too_many_lines)]
	pub async fn embed(&self, file: &tg::File) -> tg::Result<tg::File> {
		#[cfg(feature = "tracing")]
		tracing::debug!(?self, "Embedding manifest");

		// Get the paths of the required files.
		let wrapper_exe = TANGRAM_WRAPPER_EXE_PATH
			.as_ref()
			.ok_or_else(|| tg::error!("missing wrapper exe"))?;
		let objcopy = TANGRAM_OBJCOPY_PATH.as_ref();

		// Check out the input file, which is not a dependency of this executable, to get its path on
		// disk.
		let input = checkout_artifact(file.clone().into())
			.await
			.map_err(|error| tg::error!(!error, "failed to check out the input file"))?;

		// Provide the context to wrap.
		wrap::set_wrapper_exe_path(wrapper_exe.clone());
		if let Some(objcopy) = objcopy {
			wrap::set_objcopy_path(objcopy.clone());
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
			let manifest = self.clone().without_location_and_tokens();
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
			let codesign = TANGRAM_CODESIGN_PATH
				.as_ref()
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

	pub fn write_to_path(&self, path: &Path) -> tg::Result<()> {
		let manifest = self.clone().without_location_and_tokens();
		wrap::write_manifest(path, &manifest, None);
		Ok(())
	}

	fn without_location_and_tokens(mut self) -> Self {
		// Keep authorization out of the executable bytes while retaining it for dependencies.
		self.for_each_reference_mut(&mut |_, options| {
			options.location = None;
			options.tokens = tg::authorization::Tokens::default();
		});
		self
	}

	fn for_each_reference_mut(
		&mut self,
		visit: &mut impl FnMut(&tg::object::Id, &mut tg::referent::Options),
	) {
		self.for_each_template_mut(|template| visit_template_references(template, visit));
		if let Some(env) = &mut self.env {
			visit_mutation_references(env, visit);
		}
	}

	fn for_each_template_mut(&mut self, mut visit: impl FnMut(&mut tg::template::Data)) {
		fn visit_all(
			templates: &mut Option<Vec<tg::template::Data>>,
			visit: &mut impl FnMut(&mut tg::template::Data),
		) {
			for template in templates.iter_mut().flatten() {
				visit(template);
			}
		}
		visit_all(&mut self.args, &mut visit);
		match &mut self.executable {
			Executable::Address(_) => {},
			Executable::Content(template) | Executable::Path(template) => visit(template),
		}
		match &mut self.interpreter {
			Some(Interpreter::DyLd(interpreter)) => {
				visit_all(&mut interpreter.library_paths, &mut visit);
				visit_all(&mut interpreter.preloads, &mut visit);
			},
			Some(Interpreter::LdLinux(interpreter)) => {
				visit(&mut interpreter.path);
				visit_all(&mut interpreter.args, &mut visit);
				visit_all(&mut interpreter.library_paths, &mut visit);
				visit_all(&mut interpreter.preloads, &mut visit);
			},
			Some(Interpreter::LdMusl(interpreter)) => {
				visit(&mut interpreter.path);
				visit_all(&mut interpreter.args, &mut visit);
				visit_all(&mut interpreter.library_paths, &mut visit);
				visit_all(&mut interpreter.preloads, &mut visit);
			},
			Some(Interpreter::Normal(interpreter)) => {
				visit(&mut interpreter.path);
				for arg in &mut interpreter.args {
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
		let path = TANGRAM_WRAPPER_EXE_PATH
			.as_ref()
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
		.map_err(|error| tg::error!(!error, "failed to write manifest to file"))?
		.map_err(|error| tg::error!(!error, "failed to append manifest"))?;

		// Codesign if necessary.
		if matches!(wrap::detect_format(&path), Ok(Some(wrap::Format::Mach64))) {
			tracing::info!("codesigning binary");
			let codesign = TANGRAM_CODESIGN_PATH
				.as_ref()
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
		let wrapped = tg::checkin(tg::checkin::Arg {
			options: tg::checkin::Options {
				root: true,
				..tg::checkin::Options::default()
			},
			path: temp.path().to_owned(),
			updates: Vec::new(),
		})
		.await
		.map_err(|error| tg::error!(!error, "failed to check in file"))?
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

	/// Collect the dependencies from a manifest.
	#[must_use]
	pub fn dependencies(&self) -> BTreeMap<tg::Reference, Option<tg::file::Dependency>> {
		let mut dependencies = BTreeMap::new();
		self.clone().for_each_reference_mut(&mut |id, options| {
			collect_reference(id, options, &mut dependencies);
		});
		dependencies
	}
}

fn collect_reference(
	id: &tg::object::Id,
	options: &tg::referent::Options,
	dependencies: &mut BTreeMap<tg::Reference, Option<tg::file::Dependency>>,
) {
	if tg::artifact::Id::try_from(id.clone()).is_ok() {
		insert_dependency(
			dependencies,
			tg::Object::with_referent(tg::Referent::new(id.clone(), options.clone())),
		);
	}
}

pub fn collect_dependencies_from_value_data(
	value: &tg::value::Data,
	dependencies: &mut BTreeMap<tg::Reference, Option<tg::file::Dependency>>,
) {
	visit_value_references(&mut value.clone(), &mut |id, options| {
		collect_reference(id, options, dependencies);
	});
}

pub fn collect_dependencies_from_template_data(
	value: &tg::template::Data,
	dependencies: &mut BTreeMap<tg::Reference, Option<tg::file::Dependency>>,
) {
	visit_template_references(&mut value.clone(), &mut |id, options| {
		collect_reference(id, options, dependencies);
	});
}

pub fn collect_dependencies_from_mutation_data(
	value: &tg::mutation::Data,
	dependencies: &mut BTreeMap<tg::Reference, Option<tg::file::Dependency>>,
) {
	visit_mutation_references(&mut value.clone(), &mut |id, options| {
		collect_reference(id, options, dependencies);
	});
}

fn insert_dependency(
	dependencies: &mut BTreeMap<tg::Reference, Option<tg::file::Dependency>>,
	object: tg::Object,
) {
	let reference = tg::Reference::with_object(object.id());
	if let Some(Some(dependency)) = dependencies.get(&reference)
		&& let Some(existing) = &dependency.0.node
	{
		existing
			.state()
			.inherit_location(object.state().location().as_ref());
		existing.state().inherit_tokens(&object.state().tokens());
		return;
	}
	let dependency = tg::file::Dependency(tg::Referent::with_node(Some(object)));
	dependencies.insert(reference, Some(dependency));
}

fn visit_template_references(
	template: &mut tg::template::Data,
	visit: &mut impl FnMut(&tg::object::Id, &mut tg::referent::Options),
) {
	for component in &mut template.components {
		if let tg::template::data::Component::Artifact(artifact) = component {
			visit(&artifact.node.clone().into(), &mut artifact.options);
		}
	}
}

fn visit_value_references(
	value: &mut tg::value::Data,
	visit: &mut impl FnMut(&tg::object::Id, &mut tg::referent::Options),
) {
	match value {
		tg::value::Data::Object(object) => visit(&object.node, &mut object.options),
		tg::value::Data::Template(template) => visit_template_references(template, visit),
		tg::value::Data::Mutation(mutation) => visit_mutation_references(mutation, visit),
		tg::value::Data::Array(values) => {
			for value in values {
				visit_value_references(value, visit);
			}
		},
		tg::value::Data::Map(values) => {
			for value in values.values_mut() {
				visit_value_references(value, visit);
			}
		},
		_ => {},
	}
}

fn visit_mutation_references(
	mutation: &mut tg::mutation::Data,
	visit: &mut impl FnMut(&tg::object::Id, &mut tg::referent::Options),
) {
	match mutation {
		tg::mutation::Data::Unset => {},
		tg::mutation::Data::Set { value } | tg::mutation::Data::SetIfUnset { value } => {
			visit_value_references(value, visit);
		},
		tg::mutation::Data::Prepend { values } | tg::mutation::Data::Append { values } => {
			for value in values {
				visit_value_references(value, visit);
			}
		},
		tg::mutation::Data::Prefix { template, .. }
		| tg::mutation::Data::Suffix { template, .. } => visit_template_references(template, visit),
		tg::mutation::Data::Merge { value } => {
			for value in value.values_mut() {
				visit_value_references(value, visit);
			}
		},
	}
}

// These are rendered from artifacts in the manifest, so each is a dependency already present in an
// artifact root.
static TANGRAM_WRAPPER_EXE_PATH: LazyLock<Option<PathBuf>> = LazyLock::new(|| {
	std::env::var("TANGRAM_WRAPPER_EXE_PATH")
		.ok()
		.map(PathBuf::from)
});

static TANGRAM_OBJCOPY_PATH: LazyLock<Option<PathBuf>> = LazyLock::new(|| {
	std::env::var("TANGRAM_OBJCOPY_PATH")
		.ok()
		.map(PathBuf::from)
});

// Only a proxy that targets Darwin sets this.
static TANGRAM_CODESIGN_PATH: LazyLock<Option<PathBuf>> = LazyLock::new(|| {
	std::env::var("TANGRAM_CODESIGN_PATH")
		.ok()
		.map(PathBuf::from)
});
