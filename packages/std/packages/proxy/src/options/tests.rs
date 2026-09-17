use {
	super::*,
	std::{ffi::OsString, os::unix::ffi::OsStringExt as _},
};

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
