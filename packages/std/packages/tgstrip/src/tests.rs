use {super::*, std::os::unix::ffi::OsStringExt as _};

#[test]
fn controls_preserve_arguments_and_target_positions() {
	let input = vec![
		"--tg-strip-passthrough".into(),
		"--tangram-strip-passthrough=false".into(),
		"a".into(),
		"-v".into(),
		"a".into(),
		"--tg-linker-passthrough".into(),
		OsString::from_vec(b"--tg-strip-passthrough-extra=\xff".to_vec()),
		"--".into(),
		"--tg-strip-passthrough".into(),
		OsString::from_vec(b"\xff".to_vec()),
	];
	let options = Options::parse_with_args(input.clone().into_iter(), |key| match key {
		"TANGRAM_STRIP_COMMAND_PATH" => Some("strip".into()),
		"TANGRAM_STRIP_PASSTHROUGH" => Some("true".into()),
		_ => None,
	})
	.unwrap();
	assert!(!options.passthrough);
	assert_eq!(options.command_args, input[2..]);
	assert_eq!(options.strip_targets, [0, 2, 6, 7]);
	assert_eq!(
		options.wrapper_args(6, Path::new("/executable")),
		["-v".into(), "--tg-linker-passthrough".into(), input[6].clone(), "--".into(), "/executable".into()]
	);
}

#[test]
fn invalid_values_fail_before_overrides() {
	let args = ["--tg-strip-passthrough=false".into()];
	let error = Options::parse_with_args(args.into_iter(), |key| match key {
		"TANGRAM_STRIP_COMMAND_PATH" => Some("strip".into()),
		"TANGRAM_STRIP_PASSTHROUGH" => Some("SECRET_MARKER".into()),
		_ => None,
	})
	.unwrap_err();
	assert!(error.to_string().contains("TANGRAM_STRIP_PASSTHROUGH"));
	assert!(!format!("{error:?}").contains("SECRET_MARKER"));

	let args = [
		OsString::from_vec(b"--tg-strip-passthrough=SECRET_MARKER\xff".to_vec()),
		"--tangram-strip-passthrough=false".into(),
	];
	let error = Options::parse_with_args(args.into_iter(), |key| {
		(key == "TANGRAM_STRIP_COMMAND_PATH").then(|| "strip".into())
	})
	.unwrap_err();
	assert!(error.to_string().contains("--tg-strip-passthrough"));
	assert!(!format!("{error:?}").contains("SECRET_MARKER"));
}
