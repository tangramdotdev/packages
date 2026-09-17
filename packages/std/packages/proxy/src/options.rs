//! Stateless helpers for controls parsed inside native argument loops.

use {
	std::{ffi::OsStr, os::unix::ffi::OsStrExt as _},
	tangram_client::prelude::*,
};

/// Split a control without decoding its value or changing the original argument.
#[must_use]
pub fn split(arg: &OsStr) -> Option<(&str, Option<&OsStr>)> {
	let bytes = arg.as_bytes();
	let mut parts = bytes.splitn(2, |byte| *byte == b'=');
	let source = std::str::from_utf8(parts.next()?).ok()?;
	let value = parts.next().map(OsStr::from_bytes);
	Some((source, value))
}

/// Remove either CLI prefix so the consumer can match its exact option names.
#[must_use]
pub fn name(source: &str) -> Option<&str> {
	source
		.strip_prefix("--tg-")
		.or_else(|| source.strip_prefix("--tangram-"))
}

/// Parse a boolean without including the supplied value in an error.
pub fn boolean(value: &OsStr, source: &str) -> tg::Result<bool> {
	let Some(value) = value.to_str() else {
		return Err(invalid(source, "a UTF-8 boolean (true, false, 1, or 0)"));
	};
	if value.eq_ignore_ascii_case("true") || value == "1" {
		Ok(true)
	} else if value.eq_ignore_ascii_case("false") || value == "0" {
		Ok(false)
	} else {
		Err(invalid(source, "a boolean (true, false, 1, or 0)"))
	}
}

/// Require an attached UTF-8 value, keeping the payload out of errors.
pub fn value<'a>(value: Option<&'a OsStr>, source: &str) -> tg::Result<&'a str> {
	let value = value.ok_or_else(|| invalid(source, "an attached value (=VALUE)"))?;
	value
		.to_str()
		.ok_or_else(|| invalid(source, "a UTF-8 control value"))
}

/// Report the expected type using only the control name.
#[must_use]
pub fn invalid(source: &str, expected: &str) -> tg::Error {
	tg::error!("invalid control {}: expected {}", source, expected)
}

#[cfg(test)]
mod tests;
