use {super::*, std::os::unix::ffi::OsStringExt as _};

const DECLARATIONS: &[Declaration<u8>] = &[
	Declaration {
		id: 0,
		kind: Kind::Boolean,
		suffix: "enabled",
	},
	Declaration {
		id: 1,
		kind: Kind::Value,
		suffix: "text",
	},
];

#[derive(Default)]
struct Settings {
	enabled: bool,
	text: String,
}

#[allow(clippy::unnecessary_wraps)]
fn apply(settings: &mut Settings, id: u8, value: Value<'_>, _: &Source) -> tg::Result<()> {
	match (id, value) {
		(0, Value::Boolean(value)) => settings.enabled = value,
		(1, Value::Text(value)) => settings.text = value.to_owned(),
		_ => unreachable!(),
	}
	Ok(())
}

#[test]
fn aliases_environment_precedence_and_ownership() {
	for component in ["example", "second-component"] {
		let mut keys = Vec::new();
		let mut session = Session::new(
			component,
			DECLARATIONS,
			Settings::default(),
			|key| {
				keys.push(key.to_owned());
				Some(
					if key.ends_with("ENABLED") {
						"TrUe"
					} else {
						"environment"
					}
					.into(),
				)
			},
			apply,
		)
		.unwrap();
		assert_eq!(
			keys,
			[
				format!(
					"TANGRAM_{}_ENABLED",
					component.replace('-', "_").to_uppercase()
				),
				format!(
					"TANGRAM_{}_TEXT",
					component.replace('-', "_").to_uppercase()
				)
			]
		);
		for alias in ["tg", "tangram"] {
			for value in ["false", "FALSE", "0", "true", "TRUE", "1"] {
				assert!(
					session
						.consume(OsStr::new(&format!(
							"--{alias}-{component}-enabled={value}"
						)))
						.unwrap()
				);
			}
			assert!(
				session
					.consume(OsStr::new(&format!("--{alias}-{component}-enabled")))
					.unwrap()
			);
			assert!(
				session
					.consume(OsStr::new(&format!(
						"--{alias}-{component}-text=hello, world=1"
					)))
					.unwrap()
			);
		}
		assert!(
			session
				.consume(OsStr::new(&format!("--tg-{component}-enabled=false")))
				.unwrap()
		);
		for arg in [
			"",
			"@file",
			"--tg-other-enabled",
			"--tangram-suppress-args",
			"--tg-example-enabled-extra",
			"--TG-example-enabled",
			"--tg-example-text-extra=x",
		] {
			assert!(!session.consume(OsStr::new(arg)).unwrap());
		}
		assert!(
			!session
				.consume(&OsString::from_vec(b"--foreign=\xff".to_vec()))
				.unwrap()
		);
		assert!(!session.consume(OsStr::new("--")).unwrap());
		assert!(session.ended());
		assert!(
			!session
				.consume(OsStr::new(&format!("--tg-{component}-enabled")))
				.unwrap()
		);
		let settings = session.into_settings();
		assert!(!settings.enabled);
		assert_eq!(settings.text, "hello, world=1");
	}
}

#[test]
fn defaults_and_validation() {
	let session = Session::new(
		"example",
		DECLARATIONS,
		Settings::default(),
		|_| None,
		apply,
	)
	.unwrap();
	let settings = session.into_settings();
	assert!(!settings.enabled);
	assert!(settings.text.is_empty());
	for value in ["", " true", "false ", "yes", "2", "true\n"] {
		assert!(
			Session::new(
				"example",
				DECLARATIONS,
				Settings::default(),
				|_| Some(value.into()),
				apply
			)
			.is_err()
		);
		let mut session = Session::new(
			"example",
			DECLARATIONS,
			Settings::default(),
			|_| None,
			apply,
		)
		.unwrap();
		let error = session
			.consume(OsStr::new(&format!("--tg-example-enabled={value}")))
			.unwrap_err();
		assert!(error.to_string().contains("--tg-example-enabled"));
	}
	let mut session = Session::new(
		"example",
		DECLARATIONS,
		Settings::default(),
		|_| None,
		apply,
	)
	.unwrap();
	assert!(session.consume(OsStr::new("--tg-example-text")).is_err());
	assert!(!session.consume(OsStr::new("operand")).unwrap());
	assert!(
		session
			.consume(&OsString::from_vec(b"--tg-example-text=\xff".to_vec()))
			.is_err()
	);
	assert!(session.consume(OsStr::new("--tg-example-text=")).unwrap());
}

#[test]
fn declaration_validation() {
	assert!(
		Session::new(
			"Example",
			DECLARATIONS,
			Settings::default(),
			|_| None,
			apply
		)
		.is_err()
	);
	for declarations in [
		vec![Declaration {
			id: 0,
			kind: Kind::Boolean,
			suffix: "bad--name",
		}],
		vec![
			Declaration {
				id: 0,
				kind: Kind::Boolean,
				suffix: "one",
			},
			Declaration {
				id: 0,
				kind: Kind::Value,
				suffix: "two",
			},
		],
		vec![
			Declaration {
				id: 0,
				kind: Kind::Boolean,
				suffix: "one",
			},
			Declaration {
				id: 1,
				kind: Kind::Value,
				suffix: "one",
			},
		],
	] {
		assert!(
			Session::new(
				"example",
				&declarations,
				Settings::default(),
				|_| None,
				apply
			)
			.is_err()
		);
	}
}
