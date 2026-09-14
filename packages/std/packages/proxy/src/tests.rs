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
	let mut tokens = tg::authorization::Tokens::default();
	for resource in [file.id().into(), root.id().into()] {
		tokens.insert_local(tg::authorization::Token {
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
	tokens.insert(remote.clone(), tokens.local()[0].clone());
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

const ROOT: &str = "/opt/tangram/store/example";

async fn render_environment(name: &str, raw: &str, expected_paths: &[&str]) -> String {
	let mut calls = Vec::new();
	let template = environment_value(name, raw, async |path| {
		let subpath = path.strip_prefix(ROOT).unwrap().strip_prefix('/').unwrap();
		// Repeated paths return distinct proofs, so reusing an earlier result fails the test.
		let referent = checkin_referent(subpath, 100 + i64::try_from(calls.len()).unwrap());
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
	template
		.try_render(|component| async move {
			match component {
				tg::template::Component::String(string) => Ok(string.clone()),
				tg::template::Component::Artifact(_) => Ok(ROOT.to_owned()),
				tg::template::Component::Placeholder(_) => panic!("unexpected placeholder"),
			}
		})
		.await
		.unwrap()
}

#[tokio::test]
async fn environment_paths_and_flags_preserve_order_and_tokens() {
	let include = format!("{ROOT}/include space");
	let library = format!("{ROOT}/lib");
	let paths = format!(":/usr/bin:{include}::{library}:{library}:");
	for name in ["PATH", "CMAKE_PREFIX_PATH"] {
		assert_eq!(
			render_environment(name, &paths, &[&include, &library, &library]).await,
			paths
		);
	}
	let flags = format!(" -O2\t-I{library}  -L {library} ");
	for name in ["CFLAGS", "CPPFLAGS", "CXXFLAGS", "LDFLAGS"] {
		assert_eq!(
			render_environment(name, &flags, &[&library, &library]).await,
			flags
		);
	}
	let flags = format!("-Wl,-rpath-link,{library}:/usr/lib:{library}");
	assert_eq!(
		render_environment("LDFLAGS", &flags, &[&library, &library]).await,
		flags
	);
	assert_eq!(
		render_environment("CUSTOM", &include, &[&include]).await,
		include
	);
}

#[tokio::test]
async fn quoted_compiler_flags() {
	for (flag, directory) in [
		(format!("-I\"{ROOT}/include space\""), "include space"),
		(format!("-I'{ROOT}/include space'"), "include space"),
		(format!("-I{ROOT}/include\\ space"), "include space"),
		(format!("\"-I{ROOT}/include space\""), "include space"),
		(format!("-I\"{ROOT}/include'quote\""), "include'quote"),
		(format!("-I{ROOT}/lib"), "lib"),
	] {
		let prefix = r#" -DVERSION=\"1.0\"  "#;
		let flags = format!("{prefix}{flag}\t-O2 ");
		let path = format!("{ROOT}/{directory}");
		let rendered = render_environment("CFLAGS", &flags, &[&path]).await;
		assert!(rendered.starts_with(prefix));
		assert!(rendered.ends_with("\t-O2 "));
		// Interpret the forwarded flags as a make recipe would.
		let output = std::process::Command::new("/bin/sh")
			.args(["-c", "eval \"set -- $CFLAGS\"; printf '%s\\n' \"$@\""])
			.env("CFLAGS", &rendered)
			.output()
			.unwrap();
		assert!(output.status.success());
		assert_eq!(
			String::from_utf8(output.stdout).unwrap(),
			format!("-DVERSION=\"1.0\"\n-I{path}\n-O2\n")
		);
	}
}

#[tokio::test]
async fn unsupported_environment_paths_fail_before_checkin() {
	for (name, raw) in [
		("CFLAGS", "-DROOT=/opt/tangram/store/example/include"),
		(
			"CFLAGS",
			"-DROOT=/home/user/.tangram/checkouts/example/include",
		),
		("CFLAGS", "-I\"/opt/tangram/store/example/include space"),
		("CFLAGS", "-I/opt/tangram/store/example/include\\"),
		("CUSTOM", "prefix=/opt/tangram/store/example"),
	] {
		assert!(
			environment_value(name, raw, async |_| panic!("unexpected checkin"))
				.await
				.is_err()
		);
	}
}

#[tokio::test]
async fn plain_environment_values_do_not_check_in_paths() {
	for (name, raw) in [
		("PATH", ":/usr/bin::"),
		("CFLAGS", " -O2\t-g "),
		("CUSTOM", ""),
	] {
		let value = environment_value(name, raw, async |_| panic!("unexpected checkin"))
			.await
			.unwrap();
		assert_eq!(value.try_unwrap_string().unwrap(), raw);
	}
}
