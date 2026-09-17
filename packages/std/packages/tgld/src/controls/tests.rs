use {super::*, std::os::unix::ffi::OsStringExt as _};

#[test]
fn aliases_environment_and_replacement() {
	for alias in ["tg", "tangram"] {
		let mut settings = Settings::from_env(|key| {
			Some(
				match key {
					"TANGRAM_LINKER_DISALLOW_MISSING_LIBRARIES"
					| "TANGRAM_LINKER_EMBED_WRAPPER"
					| "TANGRAM_LINKER_PASSTHROUGH" => "true",
					"TANGRAM_LINKER_LIBRARY_PATH_STRATEGY" => "CoMbInE",
					"TANGRAM_LINKER_LIBRARY_SEARCH_DEPTH" => "0",
					"TANGRAM_LINKER_WRAPPER_ARGS" => "[tg.template([\"environment\"])]",
					"TANGRAM_LINKER_WRAPPER_ENV" => "tg.mutation({\"kind\":\"unset\"})",
					_ => panic!("unexpected environment key"),
				}
				.into(),
			)
		})
		.unwrap();
		assert!(settings.disallow_missing && settings.embed && settings.passthrough);
		assert_eq!(settings.library_path_strategy, LibraryPathStrategy::Combine);
		assert_eq!(settings.max_depth, 0);
		assert_eq!(settings.wrapper_arg_value.as_ref().unwrap().len(), 1);
		assert!(matches!(
			settings.wrapper_env_value,
			Some(tg::Mutation::Unset)
		));
		for (suffix, value) in [
			("disallow-missing-libraries", "false"),
			("embed-wrapper", "0"),
			("passthrough", "FALSE"),
			("library-path-strategy", "FiLtEr"),
			("library-search-depth", "001"),
			("wrapper-args", "[]"),
			(
				"wrapper-env",
				"tg.mutation({\"kind\":\"set\",\"value\":{}})",
			),
		] {
			assert!(
				settings
					.consume(OsStr::new(&format!("--{alias}-linker-{suffix}={value}")))
					.unwrap()
			);
		}
		assert!(!settings.disallow_missing && !settings.embed && !settings.passthrough);
		assert_eq!(settings.library_path_strategy, LibraryPathStrategy::Filter);
		assert_eq!(settings.max_depth, 1);
		assert!(settings.wrapper_arg_value.unwrap().is_empty());
		assert!(matches!(
			settings.wrapper_env_value,
			Some(tg::Mutation::Set { .. })
		));
	}
}

#[test]
fn invalid_control_values() {
	for (suffix, values) in [
		("disallow-missing-libraries", vec!["", " true", "yes"]),
		("embed-wrapper", vec!["", "false ", "2"]),
		("library-path-strategy", vec!["", " filter", "unknown"]),
		(
			"library-search-depth",
			vec!["", "-1", "+1", " 1", "1.0", "999999999999999999999999999"],
		),
		("passthrough", vec!["", "true\n", "no"]),
		(
			"wrapper-args",
			vec!["[\"SECRET_MARKER\"]", "[] SECRET_MARKER"],
		),
		(
			"wrapper-env",
			vec!["tg.mutation({\"kind\":\"SECRET_MARKER\"})"],
		),
	] {
		for value in values {
			let mut settings = Settings::default();
			let error = settings
				.consume(OsStr::new(&format!("--tg-linker-{suffix}={value}")))
				.unwrap_err();
			assert!(error.to_string().contains(suffix));
			assert!(!format!("{error:?}").contains("SECRET_MARKER"));
			assert!(
				Settings::from_env(|key| (key
					== format!("TANGRAM_LINKER_{}", suffix.replace('-', "_").to_uppercase()))
				.then(|| value.into()))
				.is_err()
			);
		}
		let mut settings = Settings::default();
		let source = format!("--tg-linker-{suffix}");
		let boolean = matches!(
			suffix,
			"disallow-missing-libraries" | "embed-wrapper" | "passthrough"
		);
		assert_eq!(settings.consume(OsStr::new(&source)).is_ok(), boolean);
		let arg = OsString::from_vec([source.as_bytes(), b"=SECRET_MARKER\xff"].concat());
		let error = settings.consume(&arg).unwrap_err();
		assert!(error.to_string().contains(&source));
		assert!(!format!("{error:?}").contains("SECRET_MARKER"));
	}
}

#[test]
fn ownership_and_alias_precedence() {
	let mut settings = Settings::from_env(|_| None).unwrap();
	for arg in [
		"",
		"--",
		"@file",
		"--tg-strip-passthrough",
		"--tangram-suppress-args",
		"--tg-linker-passthrough-extra",
		"--TG-linker-passthrough",
		"--tg-linker-wrapper-args-extra=x",
	] {
		assert!(!settings.consume(OsStr::new(arg)).unwrap());
	}
	for arg in [
		b"--foreign=\xff".as_slice(),
		b"--tg-linker-wrapper-args-extra=\xff",
		b"--tg-linker-passthrough\xff",
	] {
		assert!(!settings.consume(&OsString::from_vec(arg.to_vec())).unwrap());
	}
	for (arg, expected) in [
		("--tg-linker-passthrough", true),
		("--tangram-linker-passthrough=false", false),
		("--tangram-linker-passthrough", true),
		("--tg-linker-passthrough=0", false),
	] {
		assert!(settings.consume(OsStr::new(arg)).unwrap());
		assert_eq!(settings.passthrough, expected);
	}
}
