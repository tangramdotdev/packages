use super::*;

#[test]
fn inline_artifact_contents_remain_available() {
	let parsed = args(r#"[tg.template([tg.file("inline payload")])]"#).unwrap();
	let mut objects = parsed[0].objects();
	for value in [
		r#"tg.file("inline payload")"#,
		r#"tg.template([tg.file("inline payload")])"#,
		r#"tg.mutation({"kind":"set","value":tg.file("inline payload")})"#,
		r#"tg.mutation({"kind":"set_if_unset","value":tg.file("inline payload")})"#,
		r#"tg.mutation({"kind":"prefix","template":tg.template([tg.file("inline payload")])})"#,
		r#"tg.mutation({"kind":"suffix","template":tg.template([tg.file("inline payload")])})"#,
	] {
		let parsed = env(&format!(
			"tg.mutation({{\"kind\":\"set\",\"value\":{{\"FILE\":{value}}}}})"
		))
		.unwrap();
		let dependencies = parsed.objects();
		assert_eq!(dependencies.len(), 1);
		objects.extend(dependencies);
	}
	for object in objects {
		let object = object.state().object().expect("expected the inline file");
		let file = object.try_unwrap_file().unwrap();
		let tg::file::Object::Node(file) = file.as_ref() else {
			panic!("expected a file node");
		};
		let object = file
			.contents
			.state()
			.object()
			.expect("expected the inline contents");
		let blob = object.try_unwrap_blob().unwrap();
		let tg::blob::Object::Leaf(leaf) = blob.as_ref() else {
			panic!("expected a blob leaf");
		};
		assert_eq!(leaf.bytes.as_ref(), b"inline payload");
	}
}

#[test]
fn repeated_artifacts_merge_authorization() {
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
		r#"[tg.template([tg.placeholder("unresolved")])]"#,
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
		r#"tg.template([tg.placeholder("unresolved")])"#,
		r#"tg.mutation({"kind":"suffix","template":tg.template([tg.placeholder("unresolved")])})"#,
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
