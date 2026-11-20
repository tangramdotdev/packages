use {
	super::{
		SANDBOX_STORE_DIR, rewrite_depfile_contents, rewrite_depfile_paths,
		rewrite_dir_references,
	},
	std::{collections::BTreeMap, path::PathBuf},
	tangram_client::prelude::*,
};

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
		let artifact = tg::Directory::with_entries(BTreeMap::new()).into();
		let template = tg::Template::with_components([tg::template::Component::Artifact(artifact)]);
		let mut env = tg::value::Map::from([
			("GENERATED_PATH".to_owned(), raw.to_owned().into()),
			("OUT_DIR".to_owned(), template.into()),
		]);
		rewrite_dir_references(&mut env, "OUT_DIR", out_dir);
		assert_eq!(render(&env["GENERATED_PATH"]), expected, "{raw}");
	}
}

#[test]
fn depfile_paths_use_host_dirs() {
	let artifact: tg::Artifact = tg::Directory::with_entries(BTreeMap::new()).into();
	let id = artifact.id();
	let sandbox_dir = format!("{SANDBOX_STORE_DIR}/{id}");
	let contents = format!(
		"/build/lib.rmeta: {sandbox_dir}/private.rs\n\n{sandbox_dir}/private.rs:\n\n# env-dep:OUT_DIR={sandbox_dir}\n"
	);
	let host_dirs = vec![(id, PathBuf::from("/target/build/out"))];
	assert_eq!(
		rewrite_depfile_contents(&contents, &host_dirs),
		"/build/lib.rmeta: /target/build/out/private.rs\n\n/target/build/out/private.rs:\n\n# env-dep:OUT_DIR=/target/build/out\n",
	);
}

#[test]
fn depfile_paths_escape_host_dirs() {
	let artifact: tg::Artifact = tg::Directory::with_entries(BTreeMap::new()).into();
	let id = artifact.id();
	let sandbox_dir = format!("{SANDBOX_STORE_DIR}/{id}");
	let contents =
		format!("/build/lib.rmeta: {sandbox_dir}/private.rs\n\n# env-dep:OUT_DIR={sandbox_dir}\n");
	let host_dirs = vec![(id, PathBuf::from("/target dir/out"))];
	assert_eq!(
		rewrite_depfile_contents(&contents, &host_dirs),
		"/build/lib.rmeta: /target\\ dir/out/private.rs\n\n# env-dep:OUT_DIR=/target dir/out\n",
	);
}

#[test]
fn depfile_rewrite_skips_other_compilations() {
	let artifact: tg::Artifact = tg::Directory::with_entries(BTreeMap::new()).into();
	let id = artifact.id();
	let contents = format!("/build/lib.rmeta: {SANDBOX_STORE_DIR}/{id}/private.rs\n");
	let out_dir = tempfile::tempdir().unwrap();
	std::fs::write(out_dir.path().join("this.d"), &contents).unwrap();
	std::fs::write(out_dir.path().join("other.d"), &contents).unwrap();
	let depfiles = vec!["this.d".to_owned()];
	let host_dirs = vec![(id, PathBuf::from("/target/build/out"))];
	crate::runtime()
		.unwrap()
		.block_on(rewrite_depfile_paths(out_dir.path(), &depfiles, &host_dirs))
		.unwrap();
	assert_eq!(
		std::fs::read_to_string(out_dir.path().join("this.d")).unwrap(),
		"/build/lib.rmeta: /target/build/out/private.rs\n",
	);
	assert_eq!(
		std::fs::read_to_string(out_dir.path().join("other.d")).unwrap(),
		contents,
	);
}

#[test]
fn manifest_dir_references_use_the_source_artifact() {
	let artifact = tg::Directory::with_entries(BTreeMap::new()).into();
	let template = tg::Template::with_components([tg::template::Component::Artifact(artifact)]);
	let mut env = tg::value::Map::from([
		("CARGO_MANIFEST_DIR".to_owned(), template.into()),
		(
			"RUSTY_V8_SRC_BINDING_PATH".to_owned(),
			"/registry/v8-152.2.0/gen/src_binding.rs".to_owned().into(),
		),
	]);
	rewrite_dir_references(&mut env, "CARGO_MANIFEST_DIR", "/registry/v8-152.2.0");
	assert_eq!(
		render(&env["RUSTY_V8_SRC_BINDING_PATH"]),
		"/checked-in-out/gen/src_binding.rs",
	);
}

#[test]
fn out_dir_references_preserve_existing_artifacts() {
	let artifact = tg::Directory::with_entries(BTreeMap::new()).into();
	let template = tg::Template::with_components([tg::template::Component::Artifact(artifact)]);
	let value = tg::Template::builder()
		.components(template.components.clone())
		.string("/tmp/build/out/file.rs:/tmp/build/out/generated.rs")
		.build();
	let mut env = tg::value::Map::from([
		("GENERATED_PATH".to_owned(), value.into()),
		("OUT_DIR".to_owned(), template.into()),
	]);
	rewrite_dir_references(&mut env, "OUT_DIR", "/tmp/build/out");
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
