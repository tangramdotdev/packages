use {
	crate::{LibraryPathStrategy, payload},
	proxy::options::{Declaration, Kind, Source, Value},
	tangram_client::prelude::*,
};

pub const DECLARATIONS: &[Declaration<Id>] = &[
	Declaration {
		id: Id::DisallowMissing,
		kind: Kind::Boolean,
		suffix: "disallow-missing-libraries",
	},
	Declaration {
		id: Id::Embed,
		kind: Kind::Boolean,
		suffix: "embed-wrapper",
	},
	Declaration {
		id: Id::LibraryPathStrategy,
		kind: Kind::Value,
		suffix: "library-path-strategy",
	},
	Declaration {
		id: Id::MaxDepth,
		kind: Kind::Value,
		suffix: "library-search-depth",
	},
	Declaration {
		id: Id::Passthrough,
		kind: Kind::Boolean,
		suffix: "passthrough",
	},
	Declaration {
		id: Id::WrapperArgs,
		kind: Kind::Value,
		suffix: "wrapper-args",
	},
	Declaration {
		id: Id::WrapperEnv,
		kind: Kind::Value,
		suffix: "wrapper-env",
	},
];

pub struct Settings {
	pub disallow_missing: bool,
	pub embed: bool,
	pub library_path_strategy: LibraryPathStrategy,
	pub max_depth: usize,
	pub passthrough: bool,
	pub wrapper_arg_value: Option<Vec<tg::Template>>,
	pub wrapper_env_value: Option<tg::Mutation>,
}

#[derive(Clone, Copy, Eq, PartialEq)]
pub enum Id {
	DisallowMissing,
	Embed,
	LibraryPathStrategy,
	MaxDepth,
	Passthrough,
	WrapperArgs,
	WrapperEnv,
}

pub fn apply(settings: &mut Settings, id: Id, value: Value<'_>, source: &Source) -> tg::Result<()> {
	match (id, value) {
		(Id::DisallowMissing, Value::Boolean(value)) => settings.disallow_missing = value,
		(Id::Embed, Value::Boolean(value)) => settings.embed = value,
		(Id::LibraryPathStrategy, Value::Text(value)) => {
			settings.library_path_strategy = value.parse().map_err(|_| {
				source
					.invalid("a library path strategy (none, filter, resolve, isolate, or combine)")
			})?;
		},
		(Id::MaxDepth, Value::Text(value)) => {
			if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
				return Err(source.invalid("a nonnegative decimal integer within usize"));
			}
			settings.max_depth = value
				.parse()
				.map_err(|_| source.invalid("a nonnegative decimal integer within usize"))?;
		},
		(Id::Passthrough, Value::Boolean(value)) => settings.passthrough = value,
		(Id::WrapperArgs, Value::Text(value)) => {
			settings.wrapper_arg_value =
				Some(payload::args(value).map_err(|expected| source.invalid(expected))?);
		},
		(Id::WrapperEnv, Value::Text(value)) => {
			settings.wrapper_env_value =
				Some(payload::env(value).map_err(|expected| source.invalid(expected))?);
		},
		_ => unreachable!("the declarations specify the control types"),
	}
	Ok(())
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

#[cfg(test)]
mod tests;
