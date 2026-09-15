//! Component-owned controls that can be intercepted inside a native argument loop.

use {
	std::{
		collections::BTreeSet,
		ffi::{OsStr, OsString},
	},
	tangram_client::prelude::*,
};

/// An option declared once within its consuming component.
pub struct Declaration<I> {
	pub id: I,
	pub kind: Kind,
	pub suffix: &'static str,
}

#[derive(Clone, Copy)]
pub enum Kind {
	Boolean,
	Value,
}

/// One invocation, initialized from defaults and the environment.
pub struct Session<'a, I, S, F> {
	apply: F,
	declarations: &'a [Declaration<I>],
	ended: bool,
	names: Vec<[String; 3]>,
	settings: S,
}

/// A control name without its potentially sensitive value.
pub struct Source(String);

pub enum Value<'a> {
	Boolean(bool),
	Text(&'a str),
}

/// Parse a boolean without including the supplied value in an error.
pub fn boolean(value: &OsStr, source: &str) -> tg::Result<bool> {
	let source = Source(source.to_owned());
	let Some(value) = value.to_str() else {
		return Err(source.invalid("a UTF-8 boolean (true, false, 1, or 0)"));
	};
	if value.eq_ignore_ascii_case("true") || value == "1" {
		Ok(true)
	} else if value.eq_ignore_ascii_case("false") || value == "0" {
		Ok(false)
	} else {
		Err(source.invalid("a boolean (true, false, 1, or 0)"))
	}
}

impl<'a, I: Copy + Eq, S, F> Session<'a, I, S, F>
where
	F: FnMut(&mut S, I, Value<'_>, &Source) -> tg::Result<()>,
{
	pub fn new(
		component: &str,
		declarations: &'a [Declaration<I>],
		settings: S,
		mut lookup: impl FnMut(&str) -> Option<OsString>,
		apply: F,
	) -> tg::Result<Self> {
		if !valid_name(component) {
			return Err(tg::error!(
				"expected a lowercase hyphen-separated component name"
			));
		}
		let mut names = Vec::new();
		let mut suffixes = BTreeSet::new();
		for (index, declaration) in declarations.iter().enumerate() {
			if !valid_name(declaration.suffix) {
				return Err(tg::error!(
					"expected a lowercase hyphen-separated option name"
				));
			}
			if !suffixes.insert(declaration.suffix)
				|| declarations[..index]
					.iter()
					.any(|other| other.id == declaration.id)
			{
				return Err(tg::error!("encountered a duplicate option declaration"));
			}
			let name = format!("{component}-{}", declaration.suffix);
			names.push([
				format!("--tg-{name}"),
				format!("--tangram-{name}"),
				format!("TANGRAM_{}", name.replace('-', "_").to_ascii_uppercase()),
			]);
		}
		let mut session = Self {
			apply,
			declarations,
			ended: false,
			names,
			settings,
		};
		for index in 0..declarations.len() {
			let name = session.names[index][2].clone();
			if let Some(value) = lookup(&name) {
				session.apply(index, &Source(name), Some(&value))?;
			}
		}
		Ok(session)
	}

	/// Consume an owned control, or return false so the caller forwards the original word.
	/// Call only in option positions, excluding argv0 and native operands.
	pub fn consume(&mut self, arg: &OsStr) -> tg::Result<bool> {
		if self.ended {
			return Ok(false);
		}
		if arg == "--" {
			self.ended = true;
			return Ok(false);
		}
		let bytes = arg.as_encoded_bytes();
		let end = bytes
			.iter()
			.position(|byte| *byte == b'=')
			.unwrap_or(bytes.len());
		let Some((index, name)) = self.names.iter().enumerate().find_map(|(index, names)| {
			names[..2]
				.iter()
				.find(|name| name.as_bytes() == &bytes[..end])
				.map(|name| (index, name.clone()))
		}) else {
			return Ok(false);
		};
		let source = Source(name);
		let text = arg
			.to_str()
			.ok_or_else(|| source.invalid("a UTF-8 control value"))?;
		let value = text.split_once('=').map(|(_, value)| OsStr::new(value));
		self.apply(index, &source, value)?;
		Ok(true)
	}

	#[must_use]
	pub fn ended(&self) -> bool {
		self.ended
	}

	#[must_use]
	pub fn into_settings(self) -> S {
		self.settings
	}

	fn apply(&mut self, index: usize, source: &Source, value: Option<&OsStr>) -> tg::Result<()> {
		let declaration = &self.declarations[index];
		let value = match declaration.kind {
			Kind::Boolean => {
				Value::Boolean(value.map_or(Ok(true), |value| boolean(value, &source.0))?)
			},
			Kind::Value => {
				let value = value.ok_or_else(|| source.invalid("an attached value (=VALUE)"))?;
				let value = value
					.to_str()
					.ok_or_else(|| source.invalid("a UTF-8 control value"))?;
				Value::Text(value)
			},
		};
		(self.apply)(&mut self.settings, declaration.id, value, source)?;
		Ok(())
	}
}

impl Source {
	/// Report the expected type, keeping payloads and authorization tokens out of the error chain.
	#[must_use]
	pub fn invalid(&self, expected: &str) -> tg::Error {
		tg::error!("invalid control {}: expected {}", self.0, expected)
	}
}

fn valid_name(name: &str) -> bool {
	name.split('-')
		.all(|word| !word.is_empty() && word.bytes().all(|byte| byte.is_ascii_lowercase()))
}

#[cfg(test)]
mod tests;
