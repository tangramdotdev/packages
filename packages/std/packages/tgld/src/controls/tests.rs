use {super::*, proxy::options::Session, std::ffi::OsStr};

#[test]
fn aliases_environment_and_replacement() {
	for alias in ["tg", "tangram"] {
		let mut session = Session::new(
			"linker",
			DECLARATIONS,
			Settings::default(),
			|key| {
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
			},
			apply,
		)
		.unwrap();
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
				session
					.consume(OsStr::new(&format!("--{alias}-linker-{suffix}={value}")))
					.unwrap()
			);
		}
		let settings = session.into_settings();
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
fn invalid_values_fail_before_overrides() {
	for (suffix, values) in [
		("library-path-strategy", vec!["", " filter", "unknown"]),
		(
			"library-search-depth",
			vec!["", "-1", "+1", " 1", "1.0", "999999999999999999999999999"],
		),
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
			let mut session =
				Session::new("linker", DECLARATIONS, Settings::default(), |_| None, apply).unwrap();
			let error = session
				.consume(OsStr::new(&format!("--tg-linker-{suffix}={value}")))
				.unwrap_err();
			assert!(error.to_string().contains(suffix));
			assert!(!format!("{error:?}").contains("SECRET_MARKER"));
			assert!(
				Session::new(
					"linker",
					DECLARATIONS,
					Settings::default(),
					|key| (key
						== format!("TANGRAM_LINKER_{}", suffix.replace('-', "_").to_uppercase()))
					.then(|| value.into()),
					apply
				)
				.is_err()
			);
		}
		let mut session =
			Session::new("linker", DECLARATIONS, Settings::default(), |_| None, apply).unwrap();
		assert!(
			session
				.consume(OsStr::new(&format!("--tg-linker-{suffix}")))
				.is_err()
		);
	}
}
