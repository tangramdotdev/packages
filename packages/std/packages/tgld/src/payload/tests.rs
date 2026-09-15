use super::*;

#[test]
fn authorized_artifacts_and_subpaths_remain_intact() {
	let file = tg::File::with_contents("payload");
	let mut referent = file.to_referent().map(tg::artifact::Id::from);
	let mut authorization = Vec::new();
	for expires_at in [100, 200] {
		let token = tg::authorization::Token {
			body: tg::authorization::Body {
				expires_at,
				permissions: vec![tg::authorization::Permission::Object(
					tg::authorization::permission::object::Permission::Subtree,
				)],
				resource: file.id().into(),
			},
			metadata: tg::authorization::Metadata {
				algorithm: tg::authorization::Algorithm::Ed25519,
				key: "test".into(),
			},
			signature: vec![0; 64],
		};
		authorization.push(token);
	}
	referent.options.tokens = tg::Tokens::with_local_entry(tg::tokens::Entry {
		authorization,
		sync: None,
	});
	let location = tg::Location::Remote(tg::location::Remote {
		name: "test".into(),
		region: None,
	});
	referent.options.location = Some(location);
	let raw = format!("[tg.template([{referent},\"/subpath\"]),tg.template([{referent}])]");
	let parsed = args(&raw).unwrap();
	let data = parsed.iter().map(tg::Template::to_data).collect::<Vec<_>>();
	let tg::template::data::Component::Artifact(actual) = &data[0].components[0] else {
		panic!("expected an artifact");
	};
	assert_eq!(actual, &referent);
	assert_eq!(
		data[0].components[1],
		tg::template::data::Component::String("/subpath".into())
	);
	assert_eq!(data[1].components[0], data[0].components[0]);
	let mut other = referent.clone();
	let mut token = referent.options.tokens.local().unwrap().authorization[0].clone();
	token.metadata.key = "another-signer".into();
	other.options.tokens = tg::Tokens::with_local_entry(tg::tokens::Entry {
		authorization: vec![token],
		sync: None,
	});
	let env = env(&format!(
		"tg.mutation({{\"kind\":\"set\",\"value\":{{\"ARTIFACT\":{other}}}}})"
	))
	.unwrap();
	let manifest = common::Manifest {
		args: Some(parsed),
		env: Some(env),
		executable: common::manifest::Executable::Content(tg::Template::from("echo")),
		interpreter: None,
	};
	let dependencies = manifest.dependencies();
	let dependency = dependencies
		.values()
		.next()
		.unwrap()
		.as_ref()
		.unwrap()
		.0
		.node
		.as_ref()
		.unwrap();
	let mut expected = referent.options.tokens.clone();
	expected.inherit(&other.options.tokens);
	assert_eq!(dependency.state().tokens(), expected);
	assert_manifest_omits_credentials(&manifest, &expected);

	// Context from a root checkin becomes an artifact component followed by a literal subpath.
	let root = tg::Directory::with_entries(std::collections::BTreeMap::new());
	referent.options.id = Some(root.id().into());
	referent.options.path = Some("lib".into());
	let mut template =
		tg::template::Data::with_components([tg::template::data::Component::Artifact(
			referent.clone(),
		)]);
	validate_template(&mut template).unwrap();
	let tg::template::data::Component::Artifact(actual) = &template.components[0] else {
		panic!("expected an artifact root");
	};
	assert_eq!(actual.node, root.id().into());
	assert_eq!(actual.options.tokens, referent.options.tokens);
	assert_eq!(actual.options.location, referent.options.location);
	assert_eq!(
		template.components[1],
		tg::template::data::Component::String("/lib".into())
	);
}

fn assert_manifest_omits_credentials(manifest: &common::Manifest, tokens: &tg::Tokens) {
	let output = tempfile::NamedTempFile::new().unwrap();
	std::fs::copy(std::env::current_exe().unwrap(), output.path()).unwrap();
	manifest.write_to_path(output.path());
	let bytes = std::fs::read(output.path()).unwrap();
	let bytes = String::from_utf8_lossy(&bytes);
	for token in &tokens.local().unwrap().authorization {
		assert!(!bytes.contains(&token.to_string()));
	}
	let restored = common::Manifest::read_from_path(output.path())
		.unwrap()
		.unwrap();
	for dependency in restored.dependencies().values().flatten() {
		let object = dependency.0.node.as_ref().unwrap();
		assert!(object.state().tokens().is_empty());
		assert!(object.state().location().is_none());
	}
}

#[test]
fn unsupported_templates_and_values_are_rejected() {
	assert!(args(r#"[tg.template([tg.placeholder("SECRET_MARKER")])]"#).is_err());
	for value in [
		r#"tg.placeholder("SECRET_MARKER")"#,
		r#"tg.bytes("aGVsbG8=")"#,
		r#"tg.template([tg.placeholder("SECRET_MARKER")])"#,
		r#"tg.mutation({"kind":"suffix","template":tg.template([tg.placeholder("SECRET_MARKER")])})"#,
	] {
		assert!(
			env(&format!(
				"tg.mutation({{\"kind\":\"set\",\"value\":{{\"VALUE\":{value}}}}})"
			))
			.is_err()
		);
	}
}

#[test]
fn complete_payloads_and_runtime_types() {
	for text in [
		"[]",
		" \t\r\n[tg.template([\"hello, world=1\"])]\r\n",
		r#"[tg.template(["quote\"\\])}"])]"#,
	] {
		assert!(args(text).is_ok(), "{text}");
	}
	for text in [
		"",
		"[",
		"[] []",
		"[] marker",
		"[]\u{a0}",
		"[\"string\"]",
		"[tg.template([1])]",
		"[tg.template([\"unterminated])]",
	] {
		assert!(args(text).is_err(), "{text}");
	}
	for text in [
		r#"tg.mutation({"kind":"unset"})"#,
		r#"tg . mutation ( {"kind":"set","value":{}} )"#,
		r#"tg.mutation({"kind":"set","value":{"A":null,"B":true,"C":1,"D":"s","E":tg.template(["t"])}})"#,
		r#"tg.mutation({"kind":"set","value":{"A":tg.mutation({"kind":"set_if_unset","value":"a"}),"B":tg.mutation({"kind":"append","values":["a","b"]}),"C":tg.mutation({"kind":"prepend","values":[]}),"D":tg.mutation({"kind":"prefix","template":tg.template(["p"])}),"E":tg.mutation({"kind":"suffix","template":tg.template(["s"]),"separator":":"}),"F":tg.mutation({"kind":"unset"})}})"#,
	] {
		assert!(env(text).is_ok(), "{text}");
	}
	for value in [
		"[]",
		"{}",
		"tg.mutation({\"kind\":\"merge\",\"value\":{}})",
		"tg.mutation({\"kind\":\"append\",\"values\":[1]})",
		"tg.mutation({\"kind\":\"set\",\"value\":[]})",
	] {
		assert!(
			env(&format!(
				"tg.mutation({{\"kind\":\"set\",\"value\":{{\"KEY\":{value}}}}})"
			))
			.is_err()
		);
	}
	for text in [
		r#"tg.mutation({"kind":"prepend","values":[]})"#,
		r#"tg.mutation({"kind":"set","value":[]})"#,
		r#"tg.mutation({"kind":"unset"}) {}"#,
		r#"tg.mutation({"kind":"unset"}])"#,
	] {
		assert!(env(text).is_err(), "{text}");
	}
}
