use byteorder::{ReadBytesExt, WriteBytesExt};
use num::ToPrimitive;
use std::{
	collections::{BTreeMap, HashSet},
	io::{Read, Seek, Write},
	os::unix::fs::PermissionsExt,
	path::Path,
};
use tangram_client as tg;

/// The magic number used to indicate an executable has a manifest.
pub const MAGIC_NUMBER: &[u8] = b"tangram\0";

/// The manifest version.
pub const VERSION: u64 = 0;

/// The Tangram run entrypoint manifest.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct Manifest {
	/// The identity of the executable.
	pub identity: Identity,

	/// The interpreter for the executable.
	pub interpreter: Option<Interpreter>,

	/// The executable to run.
	pub executable: Executable,

	/// The environment variable mutations to apply.
	#[serde(skip_serializing_if = "Option::is_none")]
	pub env: Option<Env>,

	/// The command line arguments to pass to the executable.
	pub args: Vec<tg::template::Data>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum MaybeMutation {
	Mutation(Mutation),
	Template(tg::template::Data),
}

/// An Env can be either a single mutation or a map of mutations.
/// In the mutation case, only Unset and Set are allowed.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum Env {
	Unset,
	Map(BTreeMap<String, Vec<MaybeMutation>>),
}

impl Default for Env {
	fn default() -> Self {
		Env::Map(BTreeMap::new())
	}
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
#[serde(rename_all = "snake_case", tag = "kind", content = "value")]
pub enum Executable {
	/// A path to an executable file.
	Path(tg::template::Data),

	/// A script which will be rendered to a file and interpreted.
	Content(tg::template::Data),
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum Mutation {
	Unset,
	Set(tg::template::Data),
	SetIfUnset(tg::template::Data),
	ArrayPrepend(Vec<tg::template::Data>),
	ArrayAppend(Vec<tg::template::Data>),
	TemplatePrepend(TemplateMutationValue),
	TemplateAppend(TemplateMutationValue),
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct TemplateMutationValue {
	pub template: tg::template::Data,
	pub separator: Option<String>,
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
		file.seek(std::io::SeekFrom::Current(-length.to_i64().unwrap()))?;
		let mut manifest = vec![0u8; usize::try_from(length).unwrap()];
		file.read_exact(&mut manifest)?;
		file.seek(std::io::SeekFrom::Current(-length.to_i64().unwrap()))?;
		tracing::debug!(manifest = ?std::str::from_utf8(&manifest).unwrap());

		// Deserialize the manifest.
		let manifest = serde_json::from_slice(&manifest)?;

		Ok(Some(manifest))
	}

	/// Collect the references from a manifest.
	#[must_use]
	pub fn references(&self) -> HashSet<tg::artifact::Id, fnv::FnvBuildHasher> {
		let mut references = HashSet::default();

		// Collect the references from the interpreter.
		match &self.interpreter {
			Some(Interpreter::Normal(interpreter)) => {
				collect_references_from_template_data(&interpreter.path, &mut references);
				for arg in &interpreter.args {
					collect_references_from_template_data(arg, &mut references);
				}
			},
			Some(Interpreter::LdLinux(interpreter)) => {
				collect_references_from_template_data(&interpreter.path, &mut references);
				if let Some(library_paths) = &interpreter.library_paths {
					for library_path in library_paths {
						collect_references_from_template_data(library_path, &mut references);
					}
				}
				if let Some(preloads) = &interpreter.preloads {
					for preload in preloads {
						collect_references_from_template_data(preload, &mut references);
					}
				}
			},
			Some(Interpreter::LdMusl(interpreter)) => {
				collect_references_from_template_data(&interpreter.path, &mut references);
				if let Some(library_paths) = &interpreter.library_paths {
					for library_path in library_paths {
						collect_references_from_template_data(library_path, &mut references);
					}
				}
				if let Some(preloads) = &interpreter.preloads {
					for preload in preloads {
						collect_references_from_template_data(preload, &mut references);
					}
				}
			},
			Some(Interpreter::DyLd(interpreter)) => {
				if let Some(library_paths) = &interpreter.library_paths {
					for library_path in library_paths {
						collect_references_from_template_data(library_path, &mut references);
					}
				}
				if let Some(preloads) = &interpreter.preloads {
					for preload in preloads {
						collect_references_from_template_data(preload, &mut references);
					}
				}
			},
			None => {},
		}

		// Collect the references from the executable.
		match &self.executable {
			Executable::Path(path) => collect_references_from_template_data(path, &mut references),
			Executable::Content(template) => {
				collect_references_from_template_data(template, &mut references);
			},
		};

		// Collect the references from the env.
		if let Some(Env::Map(env)) = &self.env {
			for mutations in env.values() {
				for maybe_mutation in mutations {
					match maybe_mutation {
						MaybeMutation::Mutation(mutation) => {
							collect_references_from_mutation(mutation, &mut references);
						},
						MaybeMutation::Template(template) => {
							collect_references_from_template_data(template, &mut references);
						},
					}
				}
			}
		}

		// Collect the references from the args.
		for arg in &self.args {
			collect_references_from_template_data(arg, &mut references);
		}

		references
	}
}

pub fn collect_references_from_template_data(
	value: &tg::template::Data,
	references: &mut HashSet<tg::artifact::Id, fnv::FnvBuildHasher>,
) {
	for component in &value.components {
		if let tg::template::component::Data::Artifact(id) = component {
			references.insert(id.clone());
		}
	}
}

pub fn collect_references_from_mutation(
	value: &Mutation,
	references: &mut HashSet<tg::artifact::Id, fnv::FnvBuildHasher>,
) {
	match value {
		Mutation::Unset => {},
		Mutation::Set(value) | Mutation::SetIfUnset(value) => {
			collect_references_from_template_data(value, references);
		},
		Mutation::ArrayPrepend(values) | Mutation::ArrayAppend(values) => {
			for value in values {
				collect_references_from_template_data(value, references);
			}
		},
		Mutation::TemplatePrepend(template_mutation)
		| Mutation::TemplateAppend(template_mutation) => {
			collect_references_from_template_data(&template_mutation.template, references);
		},
	}
}
