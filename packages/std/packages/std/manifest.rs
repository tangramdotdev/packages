use std::{
	collections::BTreeMap,
	io::{Read, Seek},
	path::Path,
	str::FromStr as _,
	sync::LazyLock,
};
use tangram_client as tg;

/// The magic number used to indicate an executable has a manifest.
pub const MAGIC_NUMBER: &[u8] = b"tangram\0";

/// The manifest version.
pub const VERSION: u64 = 0;

/// The Tangram run entrypoint manifest.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct Manifest {
	/// The interpreter for the executable.
	#[serde(skip_serializing_if = "Option::is_none")]
	pub interpreter: Option<Interpreter>,

	/// The executable to run.
	pub executable: Executable,

	/// The environment variable mutations to apply.
	#[serde(skip_serializing_if = "Option::is_none")]
	pub env: Option<tg::mutation::Data>,

	/// The command line arguments to pass to the executable.
	#[serde(skip_serializing_if = "Option::is_none")]
	pub args: Option<Vec<tg::template::Data>>,
}

/// An interpreter is another program that is used to launch the executable.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind")]
pub enum Interpreter {
	/// A normal interpreter.
	#[serde(rename = "normal")]
	Normal(NormalInterpreter),

	/// An ld-linux interpreter.
	#[serde(rename = "ld-linux")]
	LdLinux(LdLinuxInterpreter),

	/// An ld-musl interpreter.
	#[serde(rename = "ld-musl")]
	LdMusl(LdMuslInterpreter),

	// A dyld interpreter.
	#[serde(rename = "dyld")]
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

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct NormalInterpreter {
	/// The path to the file to exec.
	pub path: tg::template::Data,

	/// Arguments for the interpreter.
	pub args: Vec<tg::template::Data>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LdLinuxInterpreter {
	/// The path to ld-linux.so.
	pub path: tg::template::Data,

	/// The paths for the `--library-path` argument.
	#[serde(skip_serializing_if = "Option::is_none")]
	pub library_paths: Option<Vec<tg::template::Data>>,

	/// The paths for the `--preload` argument.
	#[serde(skip_serializing_if = "Option::is_none")]
	pub preloads: Option<Vec<tg::template::Data>>,

	/// Any additional arguments.
	#[serde(skip_serializing_if = "Option::is_none")]
	pub args: Option<Vec<tg::template::Data>>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LdMuslInterpreter {
	/// The path to ld-linux.so.
	pub path: tg::template::Data,

	/// The paths for the `--library-path` argument.
	#[serde(skip_serializing_if = "Option::is_none")]
	pub library_paths: Option<Vec<tg::template::Data>>,

	/// The paths for the `--preload` argument.
	#[serde(skip_serializing_if = "Option::is_none")]
	pub preloads: Option<Vec<tg::template::Data>>,

	/// Any additional arguments.
	#[serde(skip_serializing_if = "Option::is_none")]
	pub args: Option<Vec<tg::template::Data>>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DyLdInterpreter {
	/// The paths for the `DYLD_LIBRARY_PATH` environment variable.
	#[serde(skip_serializing_if = "Option::is_none")]
	pub library_paths: Option<Vec<tg::template::Data>>,

	/// The paths for the `DYLD_INSERT_LIBRARIES` environment variable.
	#[serde(skip_serializing_if = "Option::is_none")]
	pub preloads: Option<Vec<tg::template::Data>>,
}

/// An executable launched by the entrypoint.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
pub enum Executable {
	/// A path to an executable file.
	Path(tg::template::Data),

	/// A script which will be rendered to a file and interpreted.
	Content(tg::template::Data),
}

impl Manifest {
	/// Read a manifest from the end of the given `[tg::File]`.
	pub async fn read_from_file(tg: &impl tg::Handle, file: tg::File) -> tg::Result<Option<Self>> {
		#[cfg(feature = "tracing")]
		tracing::debug!(?file, "Reading manifest from file");
		let blob = file.contents(tg).await?;
		let bytes = blob.bytes(tg).await?;
		let mut cursor = std::io::Cursor::new(bytes);
		Self::read(&mut cursor)
			.map_err(|error| tg::error!(source = error, "failed to read manifest from file"))
	}

	/// Read a manifest from the end of the file at the given path.
	pub fn read_from_path(path: impl AsRef<Path>) -> std::io::Result<Option<Self>> {
		let path = path.as_ref();
		#[cfg(feature = "tracing")]
		tracing::debug!(?path, "Reading manifest from path");
		let mut file = std::fs::File::open(path)?;
		Self::read(&mut file)
	}

	/// Read a manifest from the end of a file.
	pub fn read<R>(reader: &mut R) -> std::io::Result<Option<Self>>
	where
		R: Read + Seek,
	{
		reader.seek(std::io::SeekFrom::End(0))?;

		// Create a buffer to read 64-bit values.
		let buf = &mut [0u8; 8];

		// Read and verify the magic number.
		reader.seek(std::io::SeekFrom::Current(-8))?;
		reader.read_exact(buf)?;
		reader.seek(std::io::SeekFrom::Current(-8))?;
		if buf != MAGIC_NUMBER {
			#[cfg(feature = "tracing")]
			tracing::info!(
				"Magic number mismatch.  Recognized: {:?}, Read: {:?}",
				MAGIC_NUMBER,
				buf
			);
			return Ok(None);
		}

		// Read and verify the manifest version.
		reader.seek(std::io::SeekFrom::Current(-8))?;
		reader.read_exact(buf)?;
		let version = u64::from_le_bytes(*buf);
		reader.seek(std::io::SeekFrom::Current(-8))?;
		if version != VERSION {
			#[cfg(feature = "tracing")]
			tracing::info!(
				"Version mismatch.  Recognized: {:?}, Read: {:?}",
				VERSION,
				version
			);
			return Ok(None);
		}

		// Read the manifest length.
		reader.seek(std::io::SeekFrom::Current(-8))?;
		reader.read_exact(buf)?;
		let length = u64::from_le_bytes(*buf);
		reader.seek(std::io::SeekFrom::Current(-8))?;

		// Read the manifest.
		reader.seek(std::io::SeekFrom::Current(-i64::try_from(length).unwrap()))?;
		let mut manifest = vec![0u8; usize::try_from(length).unwrap()];
		reader.read_exact(&mut manifest)?;
		reader.seek(std::io::SeekFrom::Current(-i64::try_from(length).unwrap()))?;
		#[cfg(feature = "tracing")]
		tracing::debug!(manifest = ?std::str::from_utf8(&manifest).unwrap());

		// Deserialize the manifest.
		let manifest = serde_json::from_slice(&manifest)?;

		Ok(Some(manifest))
	}

	/// Create a new wrapper from a manifest. Will locate the wrapper file from the `TANGRAM_WRAPPER_ID` environment variable.
	pub async fn write(&self, tg: &impl tg::Handle) -> tg::Result<tg::File> {
		#[cfg(feature = "tracing")]
		tracing::debug!(?self, "Writing manifest");

		// Obtain the contents of the wrapper file.
		let wrapper_contents = TANGRAM_WRAPPER.contents(tg).await?;
		let wrapper_length = wrapper_contents.length(tg).await?;

		// Serialize the manifest.
		let mut manifest = serde_json::to_vec(self).map_err(|error| {
			tg::error!(source = error, ?self, "failed to serialize the manifest")
		})?;

		// Add three 64-bit values (manifest length, version, magic number).
		manifest.reserve_exact(3 * std::mem::size_of::<u64>());
		let suffix = u64::try_from(manifest.len())
			.unwrap()
			.to_le_bytes()
			.into_iter()
			.chain(VERSION.to_le_bytes().into_iter())
			.chain(MAGIC_NUMBER.iter().copied());
		manifest.extend(suffix);

		// Create the manifest blob.
		let manifest = std::io::Cursor::new(manifest);

		let manifest_blob = tg::Blob::with_reader(tg, manifest).await?;
		let manifest_length = manifest_blob.length(tg).await?;
		#[cfg(feature = "tracing")]
		{
			let blob_id = manifest_blob.id();
			tracing::trace!(?blob_id, ?manifest_length, "created manifest blob");
		}

		// Create a new blob with the wrapper contents and the manifest, keeping the wrapper in a separate blob.
		let output_blob = tg::Blob::new(vec![
			tg::blob::Child {
				blob: wrapper_contents,
				length: wrapper_length,
			},
			tg::blob::Child {
				blob: manifest_blob,
				length: manifest_length,
			},
		]);
		#[cfg(feature = "tracing")]
		{
			let blob_id = output_blob.id();
			tracing::trace!(?blob_id, "created wrapper blob");
		}

		// Obtain the dependencies from the manifest to add to the file.
		// NOTE: We know the wrapper file has no dependencies, so there is no need to merge.
		let dependencies = self.dependencies();
		let dependencies = if dependencies.is_empty() {
			None
		} else {
			Some(dependencies)
		};

		// Create a file with the new blob and references.
		let mut output_file = tg::File::builder(output_blob).executable(true);
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

	/// Collect the dependencies from a manifest.
	#[must_use]
	pub fn dependencies(&self) -> BTreeMap<tg::Reference, tg::Referent<tg::Object>> {
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
	dependencies: &mut BTreeMap<tg::Reference, tg::Referent<tg::Object>>,
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
	dependencies: &mut BTreeMap<tg::Reference, tg::Referent<tg::Object>>,
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
	dependencies: &mut BTreeMap<tg::Reference, tg::Referent<tg::Object>>,
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

fn dependency_from_object_id(id: &tg::object::Id) -> tg::Referent<tg::Object> {
	tg::Referent::with_item(tg::Object::with_id(id.clone()))
}

/// The compiled `tangram_wrapper` file this process should append manifests to.
static TANGRAM_WRAPPER: LazyLock<tg::File> = LazyLock::new(|| {
	let id_value = std::env::var("TANGRAM_WRAPPER_ID").expect("TANGRAM_WRAPPER_ID not set");
	let id = tg::file::Id::from_str(&id_value).expect("TANGRAM_WRAPPER_ID is not a valid file ID");
	tg::File::with_id(id)
});
