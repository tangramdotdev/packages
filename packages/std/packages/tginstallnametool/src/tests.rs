use {super::*, std::os::unix::ffi::OsStringExt as _};

fn parse(args: &[&str]) -> Options {
	let args = args.iter().map(OsString::from).collect::<Vec<_>>();
	Options::parse_with_args(args.into_iter(), |key| {
		(key == "TANGRAM_INSTALL_NAME_TOOL_COMMAND_PATH").then(|| "install_name_tool".into())
	})
	.unwrap()
}

#[test]
fn controls_preserve_arguments_and_input_position() {
	let input = vec![
		"--tg-install-name-tool-passthrough".into(),
		"-id".into(),
		"--tangram-install-name-tool-passthrough=false".into(),
		"@rpath/library.dylib".into(),
		"library.dylib".into(),
	];
	let options = Options::parse_with_args(input.into_iter(), |key| match key {
		"TANGRAM_INSTALL_NAME_TOOL_COMMAND_PATH" => Some("install_name_tool".into()),
		"TANGRAM_INSTALL_NAME_TOOL_PASSTHROUGH" => Some("true".into()),
		"TANGRAM_INSTALL_NAME_TOOL_RUNTIME_LIBRARY_PATH" => Some("/lib".into()),
		_ => None,
	})
	.unwrap();

	// The owned controls are removed wherever they appear, and the last one wins.
	assert!(!options.passthrough);
	assert_eq!(
		options.command_args,
		["-id", "@rpath/library.dylib", "library.dylib"]
	);
	assert_eq!(options.input, Some(2));
	assert_eq!(options.runtime_library_path, Some("/lib".into()));
}

#[test]
fn input_is_found_around_option_values() {
	let options = parse(&[
		"-change",
		"-old",
		"-new",
		"-rpath",
		"a",
		"b",
		"-add_rpath",
		"-id",
		"-delete_rpath",
		"c",
		"-id",
		"@rpath/libfoo.dylib",
		"-prepend_rpath",
		"d",
		"-delete_all_rpaths",
		"libfoo.dylib",
	]);
	assert_eq!(options.input, Some(15));

	let options = parse(&["program", "-add_rpath", "@loader_path/../lib"]);
	assert_eq!(options.input, Some(0));
	assert_eq!(
		options.input_args(0, Path::new("/executable")),
		["/executable", "-add_rpath", "@loader_path/../lib"]
	);
}

#[test]
fn unrecognized_arguments_pass_through() {
	assert_eq!(parse(&[]).input, None);
	assert_eq!(parse(&["-id", "name"]).input, None);
	assert_eq!(parse(&["-id"]).input, None);
	assert_eq!(parse(&["-change", "old", "program"]).input, None);
	assert_eq!(parse(&["-V", "program"]).input, None);
	assert_eq!(parse(&["--tg-strip-passthrough", "program"]).input, None);
	assert_eq!(parse(&["first", "second"]).input, None);
}

#[test]
fn invalid_values_fail_before_overrides() {
	let args = ["--tg-install-name-tool-passthrough=false".into()];
	let error = Options::parse_with_args(args.into_iter(), |key| match key {
		"TANGRAM_INSTALL_NAME_TOOL_COMMAND_PATH" => Some("install_name_tool".into()),
		"TANGRAM_INSTALL_NAME_TOOL_PASSTHROUGH" => Some("SECRET_MARKER".into()),
		_ => None,
	})
	.unwrap_err();
	assert!(
		error
			.to_string()
			.contains("TANGRAM_INSTALL_NAME_TOOL_PASSTHROUGH")
	);
	assert!(!format!("{error:?}").contains("SECRET_MARKER"));

	let args = [
		OsString::from_vec(b"--tg-install-name-tool-passthrough=SECRET_MARKER\xff".to_vec()),
		"--tangram-install-name-tool-passthrough=false".into(),
	];
	let error = Options::parse_with_args(args.into_iter(), |key| {
		(key == "TANGRAM_INSTALL_NAME_TOOL_COMMAND_PATH").then(|| "install_name_tool".into())
	})
	.unwrap_err();
	assert!(
		error
			.to_string()
			.contains("--tg-install-name-tool-passthrough")
	);
	assert!(!format!("{error:?}").contains("SECRET_MARKER"));
}

#[test]
fn missing_command_path_is_an_error() {
	let error = Options::parse_with_args(std::iter::empty(), |_| None).unwrap_err();
	assert!(
		error
			.to_string()
			.contains("TANGRAM_INSTALL_NAME_TOOL_COMMAND_PATH")
	);
}
