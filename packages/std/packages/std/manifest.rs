use std::{
	collections::BTreeMap,
	os::unix::fs::PermissionsExt,
	path::{Path, PathBuf},
	str::FromStr as _,
	sync::LazyLock,
};
use tangram_client::prelude::*;
use tokio::io::AsyncWriteExt;

use crate::CLOSEST_ARTIFACT_PATH;

/// The magic number used to indicate an executable has a manifest.
pub const MAGIC_NUMBER: &[u8] = b"tangram\0";

/// The name of the section that will appear in the binary.
pub const SECTION_NAME: &str = "tg-manifest";

/// The manifest version.
pub const VERSION: u64 = 0;

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
	pub async fn read_from_file(tg: &impl tg::Handle, file: tg::File) -> tg::Result<Option<Self>> {
		tracing::debug!(?file, "Reading manifest from file");
		let path = tg::checkout(
			tg,
			tg::checkout::Arg {
				artifact: file.id().into(),
				dependencies: false,
				force: false,
				lock: false,
				path: None,
			},
		)
		.await
		.map_err(|source| tg::error!(!source, "failed to checkout the file"))?;
		tokio::task::spawn_blocking(move || Self::read_from_path(path))
			.await
			.map_err(|source| tg::error!(!source, "failed to read the manifest"))?
			.map_err(|source| tg::error!(!source, "failed to read the manifest"))
	}

	/// Read a manifest from the end of the file at the given path.
	pub fn read_from_path(path: impl AsRef<Path>) -> std::io::Result<Option<Self>> {
		let path = path.as_ref();
		tracing::debug!(path = %path.display(), "Reading manifest from path");
		Ok(manifest_tool::read_manifest(path, None).manifest)
	}

	#[allow(clippy::too_many_lines)]
	pub async fn embed(&self, tg: &impl tg::Handle, file: &tg::File) -> tg::Result<tg::File> {
		#[cfg(feature = "tracing")]
		tracing::debug!(?self, "Embedding manifest");

		// Get the required files.
		let stub_bin = TANGRAM_STUB_BIN
			.as_ref()
			.ok_or_else(|| tg::error!("expected a stub"))?;
		let stub_elf = TANGRAM_STUB_ELF
			.as_ref()
			.ok_or_else(|| tg::error!("expected a stub"))?;
		let objcopy = TANGRAM_OBJCOPY
			.as_ref()
			.ok_or_else(|| tg::error!("expected objcopy"))?;
		let wrap = TANGRAM_WRAP
			.as_ref()
			.ok_or_else(|| tg::error!("expected a wrap binary"))?;

		// Cache all the artifacts.
		tg::cache::cache(
			tg,
			tg::cache::Arg {
				artifacts: vec![
					file.id().into(),
					stub_bin.id().into(),
					stub_elf.id().into(),
					objcopy.id().into(),
					wrap.id().into(),
				],
			},
		)
		.await
		.map_err(|source| tg::error!(!source, "failed to cache artifacts"))?;

		// Get their paths on disk.
		let path: PathBuf = CLOSEST_ARTIFACT_PATH.clone().into();
		let input = path.join(file.id().to_string());
		let stub_bin = path.join(stub_bin.id().to_string());
		let stub_elf = path.join(stub_elf.id().to_string());
		let objcopy = path.join(objcopy.id().to_string());
		let wrap = path.join(wrap.id().to_string());

		// Create a temp file for the manifest.
		let manifest = tempfile::NamedTempFile::new()
			.map_err(|source| tg::error!(!source, "failed to get temp file"))?;

		// Create the manifest file.
		let contents = serde_json::to_vec(self)
			.map_err(|source| tg::error!(!source, "failed to serialize manifest"))?;
		tokio::fs::write(manifest.path(), &contents)
			.await
			.map_err(|source| tg::error!(!source, "failed to write the manifest"))?;

		// Copy the input file to a a temp.
		let tempfile = tempfile::NamedTempFile::new()
			.map_err(|source| tg::error!(!source, "failed to create temp file"))?;
		tokio::fs::copy(&input, tempfile.path())
			.await
			.map_err(|source| tg::error!(!source, "failed to copy file"))?;
		tokio::fs::set_permissions(tempfile.as_ref(), std::fs::Permissions::from_mode(0o755))
			.await
			.map_err(|source| tg::error!(!source, "failed to set permissions"))?;

		let input = tempfile.path();

		// Add sections for the stub and manifest.
		let output_ = tokio::process::Command::new(&objcopy)
			.arg("-v")
			.arg("--add-section")
			.arg(".text.tangram-stub=/dev/null")
			.arg("--add-section")
			.arg(".note.tg-manifest=/dev/null")
			.arg(input)
			.stdout(std::process::Stdio::piped())
			.stderr(std::process::Stdio::piped())
			.output()
			.await
			.map_err(|source| tg::error!(!source, "failed to wrap the binary"))?;
		tokio::io::stderr().write_all(&output_.stderr).await.ok();
		if !output_.status.success() {
			return Err(tg::error!("objcopy subcommand failed"));
		}

		// Create a random output name.
		let tempfile = tempfile::NamedTempFile::new()
			.map_err(|source| tg::error!(!source, "failed to create temp file"))?;
		let output = tempfile.path();

		// Run the command.
		let output_ = tokio::process::Command::new(wrap)
			.arg(input)
			.arg(output)
			.arg(stub_elf)
			.arg(stub_bin)
			.arg(manifest.path())
			.stdout(std::process::Stdio::piped())
			.stderr(std::process::Stdio::piped())
			.output()
			.await
			.map_err(|source| tg::error!(!source, "failed to wrap the binary"))?;
		tokio::io::stderr().write_all(&output_.stderr).await.ok();
		if !output_.status.success() {
			return Err(tg::error!("wrap subcommand failed"));
		}

		let bytes = std::fs::read(output)
			.map_err(|source| tg::error!(!source, "failed to read the output"))?;
		std::fs::remove_file(output)
			.map_err(|source| tg::error!(!source, "failed to remove output file"))?;
		let cursor = std::io::Cursor::new(bytes);
		let blob = tg::Blob::with_reader(tg, cursor)
			.await
			.map_err(|source| tg::error!(!source, "failed to create blob"))?;

		// Obtain the dependencies from the manifest to add to the file.
		// NOTE: We know the wrapper file has no dependencies, so there is no need to merge.
		let dependencies = self.dependencies();
		let dependencies = if dependencies.is_empty() {
			None
		} else {
			Some(dependencies)
		};

		// Create a file with the new blob and references.
		let mut output_file = tg::File::builder(blob).executable(true);
		if let Some(dependencies) = dependencies {
			output_file = output_file.dependencies(dependencies);
		}
		let output_file = output_file.build();

		#[cfg(feature = "tracing")]
		{
			let file_id = output_file.id();
			tracing::trace!(?file_id, "created wrapper file");
		}

		Ok(output_file)
	}

	pub fn write_to_path(&self, path: &Path) -> tg::Result<()> {
		manifest_tool::write_manifest(path, self, None);
		Ok(())
	}

	/// Create a new wrapper from a manifest. Will locate the wrapper file from the `TANGRAM_WRAPPER_ID` environment variable.
	pub async fn write(&self, tg: &impl tg::Handle) -> tg::Result<tg::File> {
		tracing::debug!(?self, "Writing manifest");

		// Check out the wrapper file.
		let path = tg::checkout(
			tg,
			tg::checkout::Arg {
				artifact: TANGRAM_WRAPPER.id().into(),
				dependencies: false,
				force: false,
				lock: false,
				path: None,
			},
		)
		.await
		.map_err(|source| tg::error!(!source, "failed to checkout the wrapper binary"))?;

		// Create a temp.
		let temp = tempfile::NamedTempFile::new()
			.map_err(|source| tg::error!(!source, "failed to create temp file"))?;

		// Copy the wrapper to a temp.
		tokio::fs::copy(&path, temp.path())
			.await
			.map_err(|source| tg::error!(!source, "failed to copy the file"))?;
		tokio::fs::set_permissions(temp.path(), std::fs::Permissions::from_mode(0o755))
			.await
			.map_err(|source| tg::error!(!source, "failed to set permissions"))?;

		// Append the manifest to the temp.
		let path = temp.path().to_owned();
		let manifest = self.clone();
		tokio::task::spawn_blocking({
			let path = path.clone();
			move || manifest.write_to_path(&path)
		})
		.await
		.map_err(|source| tg::error!(!source, "failed to write manifest to file"))?
		.map_err(|source| tg::error!(!source, "failed to append manifest"))?;

		// Codesign if necessary.
		if matches!(
			manifest_tool::detect_format(&path),
			Ok(Some(manifest_tool::Format::Mach64))
		) {
			tracing::info!("codesigning binary");
			let path = tg::checkout(
				tg,
				tg::checkout::Arg {
					artifact: TANGRAM_CODESIGN.id().into(),
					dependencies: false,
					force: false,
					lock: false,
					path: None,
				},
			)
			.await
			.map_err(|source| tg::error!(!source, "failed to checkout the wrapper binary"))?;
			let output = tokio::process::Command::new(path)
				.arg("sign")
				.arg(temp.path())
				.stdout(std::process::Stdio::piped())
				.stdout(std::process::Stdio::piped())
				.output()
				.await
				.map_err(|source| tg::error!(!source, "codesign command failed"))?;
			if !output.status.success() {
				tokio::io::stderr().write_all(&output.stderr).await.ok();
				return Err(tg::error!("codesign command failed"));
			}
		}

		// Check the temp in.
		let wrapped = tg::checkin(
			tg,
			tg::checkin::Arg {
				options: tg::checkin::Options::default(),
				path: temp.path().to_owned(),
				updates: Vec::new(),
			},
		)
		.await
		.map_err(|source| tg::error!(!source, "failed to check in file"))?
		.try_unwrap_file()
		.map_err(|_| tg::error!("expected a file"))?;

		// Obtain the dependencies from the manifest to add to the file.
		// NOTE: We know the wrapper file has no dependencies, so there is no need to merge.
		let dependencies = self.dependencies();

		// Create a file with the new blob and references.
		let contents = wrapped
			.contents(tg)
			.await
			.map_err(|source| tg::error!(!source, "failed to get the file contents"))?;
		let mut builder = tg::File::builder(contents).executable(true);
		if !dependencies.is_empty() {
			builder = builder.dependencies(dependencies);
		}

		// Create the file.
		let output_file = builder.build();
		tracing::trace!(file = %output_file.id(), "created wrapper file");

		// Return the output file.
		Ok(output_file)
	}

	/// Collect the dependencies from a manifest.
	#[must_use]
	pub fn dependencies(&self) -> BTreeMap<tg::Reference, Option<tg::file::Dependency>> {
		let mut dependencies = BTreeMap::default();

		// Collect the references from the interpreter.
		match &self.interpreter {
			Some(Interpreter::Normal(interpreter)) => {
				collect_dependencies_from_template_data(&interpreter.path, &mut dependencies);
				for arg in &interpreter.args {
					collect_dependencies_from_template_data(arg, &mut dependencies);
				}
			},
			Some(Interpreter::LdLinux(interpreter)) => {
				collect_dependencies_from_template_data(&interpreter.path, &mut dependencies);
				if let Some(library_paths) = &interpreter.library_paths {
					for library_path in library_paths {
						collect_dependencies_from_template_data(library_path, &mut dependencies);
					}
				}
				if let Some(preloads) = &interpreter.preloads {
					for preload in preloads {
						collect_dependencies_from_template_data(preload, &mut dependencies);
					}
				}
			},
			Some(Interpreter::LdMusl(interpreter)) => {
				collect_dependencies_from_template_data(&interpreter.path, &mut dependencies);
				if let Some(library_paths) = &interpreter.library_paths {
					for library_path in library_paths {
						collect_dependencies_from_template_data(library_path, &mut dependencies);
					}
				}
				if let Some(preloads) = &interpreter.preloads {
					for preload in preloads {
						collect_dependencies_from_template_data(preload, &mut dependencies);
					}
				}
			},
			Some(Interpreter::DyLd(interpreter)) => {
				if let Some(library_paths) = &interpreter.library_paths {
					for library_path in library_paths {
						collect_dependencies_from_template_data(library_path, &mut dependencies);
					}
				}
				if let Some(preloads) = &interpreter.preloads {
					for preload in preloads {
						collect_dependencies_from_template_data(preload, &mut dependencies);
					}
				}
			},
			None => {},
		}

		// Collect the references from the executable.
		match &self.executable {
			Executable::Path(path) => {
				collect_dependencies_from_template_data(path, &mut dependencies);
			},
			Executable::Content(template) => {
				collect_dependencies_from_template_data(template, &mut dependencies);
			},
			Executable::Address(_) => (),
		}

		// Collect the references from the env.
		if let Some(env) = &self.env {
			collect_dependencies_from_mutation_data(env, &mut dependencies);
		}

		// Collect the references from the args.
		if let Some(args) = &self.args {
			for arg in args {
				collect_dependencies_from_template_data(arg, &mut dependencies);
			}
		}

		dependencies
	}
}

pub fn collect_dependencies_from_value_data(
	value: &tg::value::Data,
	dependencies: &mut BTreeMap<tg::Reference, Option<tg::file::Dependency>>,
) {
	match value {
		tg::value::Data::Object(id) => match id {
			tg::object::Id::File(id) => {
				let id = tg::object::Id::from(id.clone());
				dependencies.insert(
					tg::Reference::with_object(id.clone()),
					dependency_from_object_id(&id),
				);
			},
			tg::object::Id::Symlink(id) => {
				let id = tg::object::Id::from(id.clone());
				dependencies.insert(
					tg::Reference::with_object(id.clone()),
					dependency_from_object_id(&id),
				);
			},
			tg::object::Id::Directory(id) => {
				let id = tg::object::Id::from(id.clone());
				dependencies.insert(
					tg::Reference::with_object(id.clone()),
					dependency_from_object_id(&id),
				);
			},
			_ => {},
		},
		tg::value::Data::Mutation(data) => {
			collect_dependencies_from_mutation_data(data, dependencies);
		},
		tg::value::Data::Template(data) => {
			collect_dependencies_from_template_data(data, dependencies);
		},
		tg::value::Data::Array(arr) => {
			for value in arr {
				collect_dependencies_from_value_data(value, dependencies);
			}
		},
		tg::value::Data::Map(map) => {
			for value in map.values() {
				collect_dependencies_from_value_data(value, dependencies);
			}
		},
		_ => {},
	}
}

pub fn collect_dependencies_from_template_data(
	value: &tg::template::Data,
	dependencies: &mut BTreeMap<tg::Reference, Option<tg::file::Dependency>>,
) {
	for component in &value.components {
		if let tg::template::data::Component::Artifact(id) = component {
			let id = tg::object::Id::from(id.clone());
			dependencies.insert(
				tg::Reference::with_object(id.clone()),
				dependency_from_object_id(&id),
			);
		}
	}
}

pub fn collect_dependencies_from_mutation_data(
	value: &tg::mutation::Data,
	dependencies: &mut BTreeMap<tg::Reference, Option<tg::file::Dependency>>,
) {
	match value {
		tg::mutation::Data::Unset => {},
		tg::mutation::Data::Set { value } | tg::mutation::Data::SetIfUnset { value } => {
			collect_dependencies_from_value_data(value, dependencies);
		},
		tg::mutation::Data::Prepend { values } | tg::mutation::Data::Append { values } => {
			for value in values {
				collect_dependencies_from_value_data(value, dependencies);
			}
		},
		tg::mutation::Data::Prefix { template, .. }
		| tg::mutation::Data::Suffix { template, .. } => {
			collect_dependencies_from_template_data(template, dependencies);
		},
		tg::mutation::Data::Merge { value } => {
			for value in value.values() {
				collect_dependencies_from_value_data(value, dependencies);
			}
		},
	}
}

#[allow(clippy::unnecessary_wraps)]
fn dependency_from_object_id(id: &tg::object::Id) -> Option<tg::file::Dependency> {
	Some(tg::file::Dependency(tg::Referent::with_item(Some(
		tg::Object::with_id(id.clone()),
	))))
}

/// The compiled `tangram_wrapper` file this process should append manifests to.
static TANGRAM_WRAPPER: LazyLock<tg::File> = LazyLock::new(|| {
	let id_value = std::env::var("TANGRAM_WRAPPER_ID").expect("TANGRAM_WRAPPER_ID not set");
	let id = tg::file::Id::from_str(&id_value).expect("TANGRAM_WRAPPER_ID is not a valid file ID");
	tg::File::with_id(id)
});

static TANGRAM_STUB_BIN: LazyLock<Option<tg::File>> = LazyLock::new(|| {
	std::env::var("TANGRAM_STUB_BIN_ID").ok().map(|id| {
		let id = id.parse().expect("TANGRAM_STUB_BIN_ID is not a valid ID");
		tg::File::with_id(id)
	})
});

static TANGRAM_STUB_ELF: LazyLock<Option<tg::File>> = LazyLock::new(|| {
	std::env::var("TANGRAM_STUB_ELF_ID").ok().map(|id| {
		let id = id.parse().expect("TANGRAM_STUB_ELF_ID is not a valid ID");
		tg::File::with_id(id)
	})
});

static TANGRAM_OBJCOPY: LazyLock<Option<tg::File>> = LazyLock::new(|| {
	std::env::var("TANGRAM_OBJCOPY_ID").ok().map(|id| {
		let id = id.parse().expect("TANGRAM_WRAP_ID is not a valid ID");
		tg::File::with_id(id)
	})
});

static TANGRAM_WRAP: LazyLock<Option<tg::File>> = LazyLock::new(|| {
	std::env::var("TANGRAM_WRAP_ID").ok().map(|id| {
		let id = id.parse().expect("TANGRAM_WRAP_ID is not a valid ID");
		tg::File::with_id(id)
	})
});

static TANGRAM_CODESIGN: LazyLock<tg::File> = LazyLock::new(|| {
	let id_value = std::env::var("TANGRAM_CODESIGN_ID").expect("TANGRAM_CODESIGN_ID not set");
	let id = id_value
		.parse()
		.expect("TANGRAM_CODESIGN_ID is not a valid ID");
	tg::File::with_id(id)
});
