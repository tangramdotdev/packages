use {super::rewrite_out_dir_references, tangram_client::prelude::*};

#[test]
fn out_dir_references_respect_path_boundaries() {
	let out_dir = "/tmp/build/out";
	for (raw, expected) in [
		(out_dir, "/checked-in-out"),
		("/tmp/build/out/generated.rs", "/checked-in-out/generated.rs"),
		(
			"/tmp/build/out:/tmp/build/out/generated.rs",
			"/checked-in-out:/checked-in-out/generated.rs",
		),
		(
			"prefix=\"/tmp/build/out/generated.rs\"",
			"prefix=\"/checked-in-out/generated.rs\"",
		),
		(
			"/backup/tmp/build/out/generated.rs",
			"/backup/tmp/build/out/generated.rs",
		),
		("/tmp/build/out-other/file.rs", "/tmp/build/out-other/file.rs"),
		(
			"/tmp/build/out/tmp/build/out/file.rs",
			"/checked-in-out/tmp/build/out/file.rs",
		),
		(
			"/backup/tmp/build/out/file.rs:/tmp/build/out/file.rs",
			"/backup/tmp/build/out/file.rs:/checked-in-out/file.rs",
		),
	] {
		let artifact = tg::Directory::with_entries(Default::default()).into();
		let template = tg::Template::with_components([tg::template::Component::Artifact(artifact)]);
		let mut env = tg::value::Map::from([
			("GENERATED_PATH".to_owned(), raw.to_owned().into()),
			("OUT_DIR".to_owned(), template.into()),
		]);
		rewrite_out_dir_references(&mut env, out_dir);
		assert_eq!(render(&env["GENERATED_PATH"]), expected, "{raw}");
	}
}

#[test]
fn out_dir_references_preserve_existing_artifacts() {
	let artifact = tg::Directory::with_entries(Default::default()).into();
	let template = tg::Template::with_components([tg::template::Component::Artifact(artifact)]);
	let value = tg::Template::builder()
		.components(template.components.clone())
		.string("/tmp/build/out/file.rs:/tmp/build/out/generated.rs")
		.build();
	let mut env = tg::value::Map::from([
		("GENERATED_PATH".to_owned(), value.into()),
		("OUT_DIR".to_owned(), template.into()),
	]);
	rewrite_out_dir_references(&mut env, "/tmp/build/out");
	assert_eq!(
		render(&env["GENERATED_PATH"]),
		"/checked-in-out/tmp/build/out/file.rs:/checked-in-out/generated.rs",
	);
}

fn render(value: &tg::Value) -> String {
	match value {
		tg::Value::String(string) => string.clone(),
		tg::Value::Template(template) => template
			.try_render_sync(|component| match component {
				tg::template::Component::Artifact(_) => Ok("/checked-in-out".into()),
				tg::template::Component::Placeholder(_) => panic!("expected a literal or an artifact"),
				tg::template::Component::String(string) => Ok(string.as_str().into()),
			})
			.unwrap(),
		_ => panic!("expected a string or a template"),
	}
}
