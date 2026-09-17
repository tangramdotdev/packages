use {
	super::*,
	std::{ffi::OsString, os::unix::ffi::OsStringExt as _},
};

#[test]
fn aliases_and_attached_values() {
	for alias in ["tg", "tangram"] {
		for value in [None, Some(""), Some("hello, world=1")] {
			let source = format!("--{alias}-example-text");
			let arg = value.map_or_else(|| source.clone(), |value| format!("{source}={value}"));
			let (parsed_source, parsed_value) = split(OsStr::new(&arg)).unwrap();
			assert_eq!(parsed_source, source);
			assert_eq!(name(parsed_source), Some("example-text"));
			assert_eq!(parsed_value, value.map(OsStr::new));
		}
	}
	for source in ["", "--", "@file", "operand", "--TG-example-text"] {
		assert!(name(source).is_none());
	}
	let arg = OsString::from_vec(b"--tg-example-text=\xff".to_vec());
	let (source, value) = split(&arg).unwrap();
	assert_eq!(name(source), Some("example-text"));
	assert_eq!(value.unwrap().as_bytes(), b"\xff");
	assert!(split(&OsString::from_vec(b"--tg-example-\xff=x".to_vec())).is_none());
}

#[test]
fn boolean_values() {
	for (value, expected) in [
		("true", true),
		("TrUe", true),
		("1", true),
		("false", false),
		("FaLsE", false),
		("0", false),
	] {
		assert_eq!(boolean(OsStr::new(value), "TGCC_ENABLE").unwrap(), expected);
	}
	for value in ["", " true", "false ", "yes", "2", "true\n", "SECRET_MARKER"] {
		let error = boolean(OsStr::new(value), "TGCC_ENABLE").unwrap_err();
		assert!(error.to_string().contains("TGCC_ENABLE"));
		assert!(!format!("{error:?}").contains("SECRET_MARKER"));
	}
	assert!(boolean(&OsString::from_vec(b"\xff".to_vec()), "TGCC_ENABLE").is_err());
}

#[test]
fn required_text_values() {
	let source = "--tg-example-text";
	assert!(value(None, source).is_err());
	assert_eq!(value(Some(OsStr::new("")), source).unwrap(), "");
	assert_eq!(
		value(Some(OsStr::new("hello, world=1")), source).unwrap(),
		"hello, world=1"
	);
	let text = OsString::from_vec(b"SECRET_MARKER\xff".to_vec());
	let error = value(Some(&text), source).unwrap_err();
	assert!(error.to_string().contains(source));
	assert!(!format!("{error:?}").contains("SECRET_MARKER"));
}
