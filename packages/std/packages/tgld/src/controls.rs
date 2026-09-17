use {
	crate::{LibraryPathStrategy, payload},
	proxy::options,
	std::ffi::{OsStr, OsString},
	tangram_client::prelude::*,
};

#[derive(Debug)]
pub struct Settings {
	pub disallow_missing: bool,
	pub embed: bool,
	pub library_path_strategy: LibraryPathStrategy,
	pub max_depth: usize,
	pub passthrough: bool,
	pub wrapper_arg_value: Option<Vec<tg::Template>>,
	pub wrapper_env_value: Option<tg::Mutation>,
}

impl Settings {
	pub fn from_env(mut lookup: impl FnMut(&str) -> Option<OsString>) -> tg::Result<Self> {
		let mut settings = Self::default();
		let source = "TANGRAM_LINKER_DISALLOW_MISSING_LIBRARIES";
		if let Some(value) = lookup(source) {
			settings.disallow_missing = options::boolean(&value, source)?;
		}
		let source = "TANGRAM_LINKER_EMBED_WRAPPER";
		if let Some(value) = lookup(source) {
			settings.embed = options::boolean(&value, source)?;
		}
		let source = "TANGRAM_LINKER_LIBRARY_PATH_STRATEGY";
		if let Some(value) = lookup(source) {
			settings.library_path_strategy = library_path_strategy(Some(&value), source)?;
		}
		let source = "TANGRAM_LINKER_LIBRARY_SEARCH_DEPTH";
		if let Some(value) = lookup(source) {
			settings.max_depth = max_depth(Some(&value), source)?;
		}
		let source = "TANGRAM_LINKER_PASSTHROUGH";
		if let Some(value) = lookup(source) {
			settings.passthrough = options::boolean(&value, source)?;
		}
		let source = "TANGRAM_LINKER_WRAPPER_ARGS";
		if let Some(value) = lookup(source) {
			settings.wrapper_arg_value = Some(
				payload::args(options::value(Some(&value), source)?)
					.map_err(|expected| options::invalid(source, expected))?,
			);
		}
		let source = "TANGRAM_LINKER_WRAPPER_ENV";
		if let Some(value) = lookup(source) {
			settings.wrapper_env_value = Some(
				payload::env(options::value(Some(&value), source)?)
					.map_err(|expected| options::invalid(source, expected))?,
			);
		}
		Ok(settings)
	}

	/// Consume an owned control in an option position before the delimiter.
	pub fn consume(&mut self, arg: &OsStr) -> tg::Result<bool> {
		let Some((source, value)) = options::split(arg) else {
			return Ok(false);
		};
		match options::name(source) {
			Some("linker-disallow-missing-libraries") => {
				self.disallow_missing =
					options::boolean(value.unwrap_or(OsStr::new("true")), source)?;
			},
			Some("linker-embed-wrapper") => {
				self.embed = options::boolean(value.unwrap_or(OsStr::new("true")), source)?;
			},
			Some("linker-library-path-strategy") => {
				self.library_path_strategy = library_path_strategy(value, source)?;
			},
			Some("linker-library-search-depth") => self.max_depth = max_depth(value, source)?,
			Some("linker-passthrough") => {
				self.passthrough = options::boolean(value.unwrap_or(OsStr::new("true")), source)?;
			},
			Some("linker-wrapper-args") => {
				self.wrapper_arg_value = Some(
					payload::args(options::value(value, source)?)
						.map_err(|expected| options::invalid(source, expected))?,
				);
			},
			Some("linker-wrapper-env") => {
				self.wrapper_env_value = Some(
					payload::env(options::value(value, source)?)
						.map_err(|expected| options::invalid(source, expected))?,
				);
			},
			_ => return Ok(false),
		}
		Ok(true)
	}
}

impl Default for Settings {
	fn default() -> Self {
		Self {
			disallow_missing: false,
			embed: false,
			library_path_strategy: LibraryPathStrategy::default(),
			max_depth: 16,
			passthrough: false,
			wrapper_arg_value: None,
			wrapper_env_value: None,
		}
	}
}

fn library_path_strategy(value: Option<&OsStr>, source: &str) -> tg::Result<LibraryPathStrategy> {
	options::value(value, source)?.parse().map_err(|_| {
		options::invalid(
			source,
			"a library path strategy (none, filter, resolve, isolate, or combine)",
		)
	})
}

fn max_depth(value: Option<&OsStr>, source: &str) -> tg::Result<usize> {
	let value = options::value(value, source)?;
	if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
		return Err(options::invalid(
			source,
			"a nonnegative decimal integer within usize",
		));
	}
	value
		.parse()
		.map_err(|_| options::invalid(source, "a nonnegative decimal integer within usize"))
}

#[cfg(test)]
mod tests;
