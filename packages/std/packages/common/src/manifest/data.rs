use tangram_client::prelude::*;

/// The Tangram run entrypoint manifest.
#[derive(
	Clone,
	Debug,
	serde::Serialize,
	serde::Deserialize,
	tangram_serialize::Serialize,
	tangram_serialize::Deserialize,
)]
pub struct Manifest<T, M> {
	/// The interpreter for the executable.
	#[serde(skip_serializing_if = "Option::is_none")]
	#[tangram_serialize(id = 0, skip_serializing_if = "Option::is_none")]
	pub interpreter: Option<Interpreter<T>>,

	/// The executable to run.
	#[tangram_serialize(id = 1)]
	pub executable: Executable<T>,

	/// The environment variable mutations to apply.
	#[serde(skip_serializing_if = "Option::is_none")]
	#[tangram_serialize(id = 2, skip_serializing_if = "Option::is_none")]
	pub env: Option<M>,

	/// The command line arguments to pass to the executable.
	#[serde(skip_serializing_if = "Option::is_none")]
	#[tangram_serialize(id = 3, skip_serializing_if = "Option::is_none")]
	pub args: Option<Vec<T>>,
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
pub enum Interpreter<T> {
	/// A normal interpreter.
	#[serde(rename = "normal")]
	#[tangram_serialize(id = 0)]
	Normal(NormalInterpreter<T>),

	/// An ld-linux interpreter.
	#[serde(rename = "ld-linux")]
	#[tangram_serialize(id = 1)]
	LdLinux(LdLinuxInterpreter<T>),

	/// An ld-musl interpreter.
	#[serde(rename = "ld-musl")]
	#[tangram_serialize(id = 2)]
	LdMusl(LdMuslInterpreter<T>),

	// A dyld interpreter.
	#[serde(rename = "dyld")]
	#[tangram_serialize(id = 3)]
	DyLd(DyLdInterpreter<T>),
}

impl<T> Interpreter<T> {
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
pub struct NormalInterpreter<T> {
	/// The path to the file to exec.
	#[tangram_serialize(id = 0)]
	pub path: T,

	/// Arguments for the interpreter.
	#[tangram_serialize(id = 1)]
	pub args: Vec<T>,
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
pub struct LdLinuxInterpreter<T> {
	/// The path to ld-linux.so.
	#[tangram_serialize(id = 0)]
	pub path: T,

	/// The paths for the `--library-path` argument.
	#[serde(skip_serializing_if = "Option::is_none")]
	#[tangram_serialize(id = 1, skip_serializing_if = "Option::is_none")]
	pub library_paths: Option<Vec<T>>,

	/// The paths for the `--preload` argument.
	#[serde(skip_serializing_if = "Option::is_none")]
	#[tangram_serialize(id = 2, skip_serializing_if = "Option::is_none")]
	pub preloads: Option<Vec<T>>,

	/// Any additional arguments.
	#[serde(skip_serializing_if = "Option::is_none")]
	#[tangram_serialize(id = 3, skip_serializing_if = "Option::is_none")]
	pub args: Option<Vec<T>>,
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
pub struct LdMuslInterpreter<T> {
	/// The path to ld-linux.so.
	#[tangram_serialize(id = 0)]
	pub path: T,

	/// The paths for the `--library-path` argument.
	#[serde(skip_serializing_if = "Option::is_none")]
	#[tangram_serialize(id = 1, skip_serializing_if = "Option::is_none")]
	pub library_paths: Option<Vec<T>>,

	/// The paths for the `--preload` argument.
	#[serde(skip_serializing_if = "Option::is_none")]
	#[tangram_serialize(id = 2, skip_serializing_if = "Option::is_none")]
	pub preloads: Option<Vec<T>>,

	/// Any additional arguments.
	#[serde(skip_serializing_if = "Option::is_none")]
	#[tangram_serialize(id = 3, skip_serializing_if = "Option::is_none")]
	pub args: Option<Vec<T>>,
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
pub struct DyLdInterpreter<T> {
	/// The paths for the `DYLD_LIBRARY_PATH` environment variable.
	#[serde(skip_serializing_if = "Option::is_none")]
	#[tangram_serialize(id = 0, skip_serializing_if = "Option::is_none")]
	pub library_paths: Option<Vec<T>>,

	/// The paths for the `DYLD_INSERT_LIBRARIES` environment variable.
	#[serde(skip_serializing_if = "Option::is_none")]
	#[tangram_serialize(id = 1, skip_serializing_if = "Option::is_none")]
	pub preloads: Option<Vec<T>>,
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
pub enum Executable<T> {
	/// A path to an executable file.
	#[tangram_serialize(id = 0)]
	Path(T),

	/// A script which will be rendered to a file and interpreted.
	#[tangram_serialize(id = 1)]
	Content(T),

	/// A virtual address.
	#[tangram_serialize(id = 2)]
	Address(u64),
}

/// The on-disk manifest uses Tangram data types; the working manifest keeps handles.
pub(super) type Data = Manifest<tg::template::Data, tg::mutation::Data>;

impl super::Manifest {
	pub(super) fn to_data(&self) -> Data {
		self.clone()
			.try_map(
				|template| {
					Ok::<_, std::convert::Infallible>(
						template.to_data().without_location_and_tokens(),
					)
				},
				|mutation| Ok(mutation.to_data().without_location_and_tokens()),
			)
			.unwrap()
	}

	pub(super) fn try_from_data(data: Data) -> tg::Result<Self> {
		data.try_map(tg::Template::try_from_data, tg::Mutation::try_from_data)
	}
}

impl<T, M> Manifest<T, M> {
	pub(super) fn try_map<U, N, E>(
		self,
		mut template: impl FnMut(T) -> Result<U, E>,
		mutation: impl FnOnce(M) -> Result<N, E>,
	) -> Result<Manifest<U, N>, E> {
		fn templates<T, U, E>(
			values: Option<Vec<T>>,
			convert: &mut impl FnMut(T) -> Result<U, E>,
		) -> Result<Option<Vec<U>>, E> {
			values
				.map(|values| values.into_iter().map(convert).collect())
				.transpose()
		}
		let executable = match self.executable {
			Executable::Path(value) => Executable::Path(template(value)?),
			Executable::Content(value) => Executable::Content(template(value)?),
			Executable::Address(address) => Executable::Address(address),
		};
		let interpreter = self
			.interpreter
			.map(|interpreter| {
				Ok(match interpreter {
					Interpreter::Normal(value) => Interpreter::Normal(NormalInterpreter {
						path: template(value.path)?,
						args: value
							.args
							.into_iter()
							.map(&mut template)
							.collect::<Result<_, E>>()?,
					}),
					Interpreter::LdLinux(value) => Interpreter::LdLinux(LdLinuxInterpreter {
						path: template(value.path)?,
						args: templates(value.args, &mut template)?,
						library_paths: templates(value.library_paths, &mut template)?,
						preloads: templates(value.preloads, &mut template)?,
					}),
					Interpreter::LdMusl(value) => Interpreter::LdMusl(LdMuslInterpreter {
						path: template(value.path)?,
						args: templates(value.args, &mut template)?,
						library_paths: templates(value.library_paths, &mut template)?,
						preloads: templates(value.preloads, &mut template)?,
					}),
					Interpreter::DyLd(value) => Interpreter::DyLd(DyLdInterpreter {
						library_paths: templates(value.library_paths, &mut template)?,
						preloads: templates(value.preloads, &mut template)?,
					}),
				})
			})
			.transpose()?;
		Ok(Manifest {
			interpreter,
			executable,
			args: templates(self.args, &mut template)?,
			env: self.env.map(mutation).transpose()?,
		})
	}
}
