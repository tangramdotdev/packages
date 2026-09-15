use super::*;

#[test]
fn checkin_template_retains_root_subpath_and_all_tokens() {
	let referent = checkin_referent("lib", 100);
	let template = template_from_referent(&referent).unwrap();
	let [
		tg::template::Component::Artifact(artifact),
		tg::template::Component::String(path),
	] = template.components()
	else {
		panic!("expected a root and subpath");
	};
	assert_eq!(
		artifact.id().to_string(),
		referent.options.id.unwrap().to_string()
	);
	assert_eq!(path, "/lib");
	assert_eq!(
		artifact.to_referent().options.tokens,
		referent.options.tokens
	);
	assert_eq!(
		artifact.to_referent().options.location,
		referent.options.location
	);
}

fn checkin_referent(path: &str, expires_at: i64) -> tg::Referent<tg::artifact::Id> {
	let file = tg::File::with_contents("library");
	let root = tg::Directory::with_entries([("lib".to_owned(), file.clone().into())].into());
	let mut tokens = tg::Tokens::default();
	for resource in [file.id().into(), root.id().into()] {
		tokens.insert_local_authorization(tg::authorization::Token {
			body: tg::authorization::Body {
				expires_at,
				permissions: vec![tg::authorization::Permission::Object(
					tg::authorization::permission::object::Permission::Subtree,
				)],
				resource,
			},
			metadata: tg::authorization::Metadata {
				algorithm: tg::authorization::Algorithm::Ed25519,
				key: "test".into(),
			},
			signature: vec![0; 64],
		});
	}
	let remote = tg::Location::Remote(tg::location::Remote {
		name: "test".into(),
		region: None,
	});
	tokens.insert_authorization(remote.clone(), tokens.local_authorization()[0].clone());
	tg::Referent::new(
		file.id().into(),
		tg::referent::Options {
			id: Some(root.id().into()),
			path: Some(path.into()),
			location: Some(remote),
			tokens,
			..Default::default()
		},
	)
}

fn root() -> String {
	format!(
		"/opt/tangram/store/{}",
		tg::Directory::with_entries(std::collections::BTreeMap::new()).id()
	)
}

async fn render_environment(name: &str, raw: &str, expected_paths: &[&str]) -> String {
	let mut calls = Vec::new();
	let template = environment_value(name, raw, async |path| {
		// Return distinct proofs on repeated calls, and an identity supplied by checkin.
		let referent = checkin_referent(
			path.trim_start_matches('/'),
			100 + i64::try_from(calls.len()).unwrap(),
		);
		calls.push((path.to_owned(), referent.clone()));
		template_from_referent(&referent)
	})
	.await
	.unwrap()
	.try_unwrap_template()
	.unwrap();
	assert_eq!(
		calls
			.iter()
			.map(|(path, _)| path.as_str())
			.collect::<Vec<_>>(),
		expected_paths
	);
	assert_eq!(template.artifacts().count(), calls.len());
	for (artifact, (_, referent)) in template.artifacts().zip(&calls) {
		assert_eq!(
			artifact.id().to_string(),
			referent.options.id.as_ref().unwrap().to_string()
		);
		assert_eq!(
			artifact.to_referent().options.tokens,
			referent.options.tokens
		);
		assert_eq!(
			artifact.to_referent().options.location,
			referent.options.location
		);
	}
	render(&template)
}

#[tokio::test]
async fn environment_references_preserve_text_order_and_tokens() {
	let root = root();
	let checkout = root.replace("/store/", "/checkouts/");
	let raw =
		format!(":/usr/bin:./local:{root}/lib space::{checkout}/nonexistent suffix:{root}/bin:");
	for name in ["PATH", "CMAKE_PREFIX_PATH", "CUSTOM"] {
		assert_eq!(
			render_environment(name, &raw, &[&root, &checkout, &root]).await,
			raw
		);
	}
	let raw = format!("prefix=\"{root}/a'b\\c\"\n-DROOT={root}/include -I./local");
	for name in ["CFLAGS", "CPPFLAGS", "CXXFLAGS", "LDFLAGS", "CUSTOM"] {
		assert_eq!(render_environment(name, &raw, &[&root, &root]).await, raw);
	}
}

#[tokio::test]
async fn references_under_ancestor_store_roots() {
	let executable = std::env::current_exe().unwrap().canonicalize().unwrap();
	let parent = executable.parent().unwrap();
	for (directory, id) in [
		("store", tg::File::with_contents("file").id().to_string()),
		(
			"checkouts",
			tg::Symlink::with_path("target".into()).id().to_string(),
		),
	] {
		let root = format!("{}/.tangram/{directory}/{id}", parent.display());
		let raw = format!("prefix={root}/suffix");
		assert_eq!(render_environment("CUSTOM", &raw, &[&root]).await, raw);
	}
}

#[tokio::test]
async fn quoted_compiler_flags_keep_their_spelling() {
	let root = root();
	for flag in [
		format!("-I\"{root}/include space\""),
		format!("-I'{root}/include space'"),
		format!("-I{root}/include\\ space"),
		format!("\"-I{root}/include space\""),
	] {
		let raw = format!(" -DVERSION=\\\"1.0\\\"  {flag}\t-O2 ");
		let rendered = render_environment("CFLAGS", &raw, &[&root]).await;
		assert_eq!(rendered, raw);
		let output = std::process::Command::new("/bin/sh")
			.args(["-c", "eval \"set -- $CFLAGS\"; printf '%s\\n' \"$@\""])
			.env("CFLAGS", &rendered)
			.output()
			.unwrap();
		assert!(output.status.success());
		assert_eq!(
			String::from_utf8(output.stdout).unwrap(),
			format!("-DVERSION=\"1.0\"\n-I{root}/include space\n-O2\n")
		);
	}
}

#[tokio::test]
async fn interpreter_arguments_preserve_boundaries_and_tokens() {
	let root = root();
	let raw = format!(
		"--library-path ':{root}/lib space:/usr/lib:$ORIGIN/lib:' --preload='{root}/a.so {root}/b.so' --argv0 /literal/name '' \"{root}/path'quote:colon=equal\""
	);
	let mut calls = Vec::new();
	let args = interpreter_args(&raw, async |path| {
		assert_eq!(path, root);
		let referent = checkin_referent(
			path.trim_start_matches('/'),
			100 + i64::try_from(calls.len()).unwrap(),
		);
		calls.push(referent.clone());
		template_from_referent(&referent)
	})
	.await
	.unwrap();
	assert_eq!(calls.len(), 4);
	let artifacts = args
		.iter()
		.flat_map(tg::Template::artifacts)
		.collect::<Vec<_>>();
	assert_eq!(artifacts.len(), calls.len());
	for (artifact, referent) in artifacts.into_iter().zip(calls) {
		assert_eq!(
			artifact.to_referent().options.tokens,
			referent.options.tokens
		);
		assert_eq!(
			artifact.to_referent().options.location,
			referent.options.location
		);
	}
	assert_eq!(
		args.iter().map(render).collect::<Vec<_>>(),
		shlex::split(&raw).unwrap()
	);
}

#[tokio::test]
async fn interpreter_arguments_decode_shell_quoting() {
	let args = interpreter_args(
		r#"'' 'literal words' "double\"quote" escaped\ space 'a'\''b' '$HOME;$(false)'"#,
		async |_| panic!("unexpected checkin"),
	)
	.await
	.unwrap();
	assert_eq!(
		args.iter().map(render).collect::<Vec<_>>(),
		[
			"",
			"literal words",
			"double\"quote",
			"escaped space",
			"a'b",
			"$HOME;$(false)"
		]
	);
	for raw in ["'unterminated", "trailing\\"] {
		assert!(
			interpreter_args(raw, async |_| panic!("unexpected checkin"))
				.await
				.is_err()
		);
	}
}

#[tokio::test]
async fn ordinary_environment_paths_and_text_stay_literal() {
	for (name, raw) in [
		("PATH", "/usr/bin:/bin:/missing/bin:./local::"),
		("TMPDIR", "/temporary/output"),
		("TANGRAM_OUTPUT", "/process/output"),
		("PWD", "/working/directory"),
		("CUSTOM", "prefix=/opt/tangram/store/not-an-artifact"),
		("CUSTOM", "/local/input"),
		("CUSTOM", "./local/input"),
		("CPATH", "./local/include"),
		(
			"CFLAGS",
			"-I./include -I/usr/include -o /output -DROOT=/literal/path",
		),
		("CFLAGS", "'unterminated"),
		("CUSTOM", ""),
	] {
		let value = environment_value(name, raw, async |_| panic!("unexpected checkin"))
			.await
			.unwrap();
		assert_eq!(value.try_unwrap_string().unwrap(), raw);
	}
}

fn render(template: &tg::Template) -> String {
	template
		.try_render_sync(|component| match component {
			tg::template::Component::String(string) => Ok(string.as_str().into()),
			tg::template::Component::Artifact(_) => Ok("".into()),
			tg::template::Component::Placeholder(_) => panic!("unexpected placeholder"),
		})
		.unwrap()
}
