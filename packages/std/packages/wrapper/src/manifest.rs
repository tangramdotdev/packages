use byteorder::{ReadBytesExt, WriteBytesExt};
use std::{
	collections::HashSet,
	hash::BuildHasher,
	io::{Read, Seek, Write},
	os::unix::fs::PermissionsExt,
	path::Path,
};
use tangram_client as tg;

/// The magic number used to indicate an executable has a manifest.
pub const MAGIC_NUMBER: &[u8] = b"tangram\0";

/// The manifest version.
pub const VERSION: u64 = 0;

/// Set the algorithm used to hash IDs.;
type Hasher = fnv::FnvBuildHasher;

/// The Tangram run entrypoint manifest.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct Manifest {
	/// The identity of the executable.
	pub identity: Identity,

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

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Identity {
	Wrapper,
	Interpreter,
	Executable,
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

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct NormalInterpreter {
	/// The path to the file to exec.
	pub path: tg::symlink::Data,

	/// Arguments for the interpreter.
	pub args: Vec<tg::template::Data>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LdLinuxInterpreter {
	/// The path to ld-linux.so.
	pub path: tg::symlink::Data,

	/// The paths for the `--library-path` argument.
	#[serde(skip_serializing_if = "Option::is_none")]
	pub library_paths: Option<Vec<tg::symlink::Data>>,

	/// The paths for the `--preload` argument.
	#[serde(skip_serializing_if = "Option::is_none")]
	pub preloads: Option<Vec<tg::symlink::Data>>,

	/// Any additional arguments.
	#[serde(skip_serializing_if = "Option::is_none")]
	pub args: Option<Vec<tg::template::Data>>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LdMuslInterpreter {
	/// The path to ld-linux.so.
	pub path: tg::symlink::Data,

	/// The paths for the `--library-path` argument.
	#[serde(skip_serializing_if = "Option::is_none")]
	pub library_paths: Option<Vec<tg::symlink::Data>>,

	/// The paths for the `--preload` argument.
	#[serde(skip_serializing_if = "Option::is_none")]
	pub preloads: Option<Vec<tg::symlink::Data>>,

	/// Any additional arguments.
	#[serde(skip_serializing_if = "Option::is_none")]
	pub args: Option<Vec<tg::template::Data>>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DyLdInterpreter {
	/// The paths for the `DYLD_LIBRARY_PATH` environment variable.
	#[serde(skip_serializing_if = "Option::is_none")]
	pub library_paths: Option<Vec<tg::symlink::Data>>,

	/// The paths for the `DYLD_INSERT_LIBRARIES` environment variable.
	#[serde(skip_serializing_if = "Option::is_none")]
	pub preloads: Option<Vec<tg::symlink::Data>>,
}

/// An executable launched by the entrypoint.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
pub enum Executable {
	/// A path to an executable file.
	Path(tg::symlink::Data),

	/// A script which will be rendered to a file and interpreted.
	Content(tg::template::Data),
}

impl Manifest {
	/// Write a manifest to the end of a file.
	pub fn write(&self, path: &Path) -> std::io::Result<()> {
		tracing::debug!(?path, "Writing manifest");

		let perms = std::fs::metadata(path)?.permissions();
		let mode = perms.mode();
		tracing::debug!("Mode: {mode:o}");

		// Open the file.
		let mut file = std::fs::OpenOptions::new().append(true).open(path)?;
		tracing::debug!(?file);

		// Serialize the manifest.
		let manifest = serde_json::to_string(self)?;

		// Write the manifest.
		file.write_all(manifest.as_bytes())?;
		tracing::debug!("Wrote manifest");

		// Write the length of the manifest.
		let length = manifest.len() as u64;
		file.write_u64::<byteorder::LittleEndian>(length)?;

		// Write the manifest version.
		file.write_u64::<byteorder::LittleEndian>(VERSION)?;

		// Write the magic number.
		file.write_all(MAGIC_NUMBER)?;

		Ok(())
	}

	/// Read a manifest from the end of a file.
	pub fn read(path: &Path) -> std::io::Result<Option<Self>> {
		tracing::debug!(?path, "Reading manifest");
		// Open the file and seek to the end.
		let mut file = std::fs::File::open(path)?;
		file.seek(std::io::SeekFrom::End(0))?;

		// Read and verify the magic number.
		file.seek(std::io::SeekFrom::Current(-8))?;
		let mut magic_number = [0u8; MAGIC_NUMBER.len()];
		file.read_exact(&mut magic_number)?;
		file.seek(std::io::SeekFrom::Current(-8))?;
		if magic_number != MAGIC_NUMBER {
			return Ok(None);
		};

		// Read and verify the manifest version.
		file.seek(std::io::SeekFrom::Current(-8))?;
		let version = file.read_u64::<byteorder::LittleEndian>()?;
		file.seek(std::io::SeekFrom::Current(-8))?;
		if version != VERSION {
			return Ok(None);
		}

		// Read the manifest length.
		file.seek(std::io::SeekFrom::Current(-8))?;
		let length = file.read_u64::<byteorder::LittleEndian>()?;
		file.seek(std::io::SeekFrom::Current(-8))?;

		// Read the manifest.
		file.seek(std::io::SeekFrom::Current(-i64::try_from(length).unwrap()))?;
		let mut manifest = vec![0u8; usize::try_from(length).unwrap()];
		file.read_exact(&mut manifest)?;
		file.seek(std::io::SeekFrom::Current(-i64::try_from(length).unwrap()))?;
		tracing::debug!(manifest = ?std::str::from_utf8(&manifest).unwrap());

		// Deserialize the manifest.
		let manifest = serde_json::from_slice(&manifest)?;

		Ok(Some(manifest))
	}

	/// Collect the references from a manifest.
	#[must_use]
	pub fn references(&self) -> HashSet<tg::artifact::Id, Hasher> {
		let mut references = HashSet::default();

		// Collect the references from the interpreter.
		match &self.interpreter {
			Some(Interpreter::Normal(interpreter)) => {
				collect_references_from_symlink_data(&interpreter.path, &mut references);
				for arg in &interpreter.args {
					collect_references_from_template_data(arg, &mut references);
				}
			},
			Some(Interpreter::LdLinux(interpreter)) => {
				collect_references_from_symlink_data(&interpreter.path, &mut references);
				if let Some(library_paths) = &interpreter.library_paths {
					for library_path in library_paths {
						collect_references_from_symlink_data(library_path, &mut references);
					}
				}
				if let Some(preloads) = &interpreter.preloads {
					for preload in preloads {
						collect_references_from_symlink_data(preload, &mut references);
					}
				}
			},
			Some(Interpreter::LdMusl(interpreter)) => {
				collect_references_from_symlink_data(&interpreter.path, &mut references);
				if let Some(library_paths) = &interpreter.library_paths {
					for library_path in library_paths {
						collect_references_from_symlink_data(library_path, &mut references);
					}
				}
				if let Some(preloads) = &interpreter.preloads {
					for preload in preloads {
						collect_references_from_symlink_data(preload, &mut references);
					}
				}
			},
			Some(Interpreter::DyLd(interpreter)) => {
				if let Some(library_paths) = &interpreter.library_paths {
					for library_path in library_paths {
						collect_references_from_symlink_data(library_path, &mut references);
					}
				}
				if let Some(preloads) = &interpreter.preloads {
					for preload in preloads {
						collect_references_from_symlink_data(preload, &mut references);
					}
				}
			},
			None => {},
		}

		// Collect the references from the executable.
		match &self.executable {
			Executable::Path(path) => collect_references_from_symlink_data(path, &mut references),
			Executable::Content(template) => {
				collect_references_from_template_data(template, &mut references);
			},
		};

		// Collect the references from the env.
		if let Some(env) = &self.env {
			collect_references_from_mutation_data(env, &mut references);
		}

		// Collect the references from the args.
		if let Some(args) = &self.args {
			for arg in args {
				collect_references_from_template_data(arg, &mut references);
			}
		}

		references
	}
}

pub fn collect_references_from_value_data<H: BuildHasher>(
	value: &tg::value::Data,
	references: &mut HashSet<tg::artifact::Id, H>,
) {
	match value {
		tg::value::Data::Directory(id) => {
			references.insert(id.clone().try_into().unwrap());
		},
		tg::value::Data::File(id) => {
			references.insert(id.clone().try_into().unwrap());
		},
		tg::value::Data::Symlink(id) => {
			references.insert(id.clone().try_into().unwrap());
		},
		tg::value::Data::Mutation(data) => {
			collect_references_from_mutation_data(data, references);
		},
		tg::value::Data::Template(data) => {
			collect_references_from_template_data(data, references);
		},
		tg::value::Data::Array(arr) => {
			for value in arr {
				collect_references_from_value_data(value, references);
			}
		},
		tg::value::Data::Map(map) => {
			for value in map.values() {
				collect_references_from_value_data(value, references);
			}
		},
		_ => {},
	}
}

pub fn collect_references_from_artifact_data<H: BuildHasher>(
	value: &tg::artifact::Data,
	references: &mut HashSet<tg::artifact::Id, H>,
) {
	match value {
		tg::artifact::Data::Directory(data) => {
			for id in data.entries.values() {
				references.insert(id.clone());
			}
		},
		tg::artifact::Data::File(data) => {
			for id in &data.references {
				references.insert(id.clone());
			}
		},
		tg::artifact::Data::Symlink(data) => {
			collect_references_from_symlink_data(data, references);
		},
	}
}

pub fn collect_references_from_symlink_data<H: BuildHasher>(
	value: &tg::symlink::Data,
	references: &mut HashSet<tg::artifact::Id, H>,
) {
	if let Some(id) = &value.artifact {
		references.insert(id.clone());
	}
}

pub fn collect_references_from_template_data<H: BuildHasher>(
	value: &tg::template::Data,
	references: &mut HashSet<tg::artifact::Id, H>,
) {
	for component in &value.components {
		if let tg::template::component::Data::Artifact(id) = component {
			references.insert(id.clone());
		}
	}
}

pub fn collect_references_from_mutation_data<H: BuildHasher>(
	value: &tg::mutation::Data,
	references: &mut HashSet<tg::artifact::Id, H>,
) {
	match value {
		tg::mutation::Data::Unset => {},
		tg::mutation::Data::Set { value } | tg::mutation::Data::SetIfUnset { value } => {
			collect_references_from_value_data(value, references);
		},
		tg::mutation::Data::ArrayPrepend { values }
		| tg::mutation::Data::ArrayAppend { values } => {
			for value in values {
				collect_references_from_value_data(value, references);
			}
		},
		tg::mutation::Data::TemplatePrepend { template, .. }
		| tg::mutation::Data::TemplateAppend { template, .. } => {
			collect_references_from_template_data(template, references);
		},
	}
}
