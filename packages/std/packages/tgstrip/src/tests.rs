use {super::*, std::os::unix::ffi::OsStringExt as _};

#[test]
fn controls_and_occurrence_positions() {
	for alias in ["tg", "tangram"] {
		for value in ["true", "TRUE", "1", "false", "FALSE", "0"] {
			let input = [
				format!("--{alias}-strip-passthrough={value}"),
				"a".into(),
				"-v".into(),
				"a".into(),
				"b".into(),
				"--".into(),
				"--tg-strip-passthrough".into(),
			];
			let options = Options::parse_with_args(input.into_iter().map(Into::into), |key| {
				Some(
					if key.ends_with("PASSTHROUGH") {
						"true"
					} else {
						"strip"
					}
					.into(),
				)
			})
			.unwrap();
			assert_eq!(
				options.passthrough,
				value.eq_ignore_ascii_case("true") || value == "1"
			);
			assert_eq!(options.strip_targets, [0, 2, 3, 5]);
			assert_eq!(
				options.wrapper_args(2, Path::new("/executable")),
				["-v", "/executable", "--"].map(OsString::from)
			);
			assert_eq!(
				options.wrapper_args(5, Path::new("/executable")),
				["-v", "--", "/executable"].map(OsString::from)
			);
		}
	}
}

#[test]
fn exact_forwarding_and_environment_validation() {
	let input = vec![
		"--tg-strip-passthrough".into(),
		"--tangram-strip-passthrough=false".into(),
		"--tg-strip-passthrough-extra".into(),
		"--tg-linker-passthrough=false".into(),
		"".into(),
		"a b=c,d".into(),
		OsString::from_vec(b"\xff".to_vec()),
	];
	let options = Options::parse_with_args(input.clone().into_iter(), |key| {
		(key == "TANGRAM_STRIP_COMMAND_PATH").then(|| "strip".into())
	})
	.unwrap();
	assert!(!options.passthrough);
	assert_eq!(options.command_args, input[2..]);
	for value in ["", " true", "false ", "yes"] {
		assert!(
			Options::parse_with_args(["--tg-strip-passthrough=false".into()].into_iter(), |key| {
				Some(
					if key.ends_with("PASSTHROUGH") {
						value
					} else {
						"strip"
					}
					.into(),
				)
			})
			.is_err()
		);
	}
}
