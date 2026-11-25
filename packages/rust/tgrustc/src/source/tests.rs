use {
	super::{external_files, included_paths, normalize, relative_path},
	std::path::{Path, PathBuf},
};

#[test]
fn included_paths_finds_literal_paths() {
	let text = r##"
		const A: &str = include_str!("a.txt");
		const B: &[u8] = include_bytes! ( "../b.bin" );
		include!(concat!(env!("OUT_DIR"), "/generated.rs"));
		const C: &str = include_str!(
			"../../c.json"
		);
		const D: &str = include_str!(r#"d "quoted".txt"#);
		const E: &str = include_str!("e\\escaped.txt");
		my_include_str!("ignored.txt");
	"##;
	let paths = included_paths(text);
	assert_eq!(
		paths,
		vec![
			"../b.bin".to_owned(),
			"a.txt".to_owned(),
			"../../c.json".to_owned(),
			"d \"quoted\".txt".to_owned(),
		],
	);
}

#[test]
fn normalize_resolves_parent_components() {
	let path = normalize(Path::new("/w/packages/app/src/./../../../shared/data.txt"));
	assert_eq!(path, PathBuf::from("/w/shared/data.txt"));
}

#[test]
fn external_files_follows_includes_out_of_the_crate() {
	// Create a Cargo source with a crate that includes a file from a sibling directory through an included Rust file, and a file of its own.
	let temp = tempfile::tempdir().unwrap();
	let root = temp.path().canonicalize().unwrap();
	let app = root.join("packages/app");
	std::fs::create_dir_all(app.join("src")).unwrap();
	std::fs::create_dir_all(root.join("shared")).unwrap();
	std::fs::write(
		app.join("src/main.rs"),
		"include!(\"../../../shared/messages.rs\");\nconst OWN: &str = include_str!(\"own.txt\");\nconst MISSING: &str = include_str!(\"../../../shared/missing.txt\");\n",
	)
	.unwrap();
	std::fs::write(app.join("src/own.txt"), "own").unwrap();
	std::fs::write(
		root.join("shared/messages.rs"),
		"const MESSAGE: &str = include_str!(\"message.txt\");\n",
	)
	.unwrap();
	std::fs::write(root.join("shared/message.txt"), "hello").unwrap();
	std::fs::write(root.join("outside.txt"), "outside").unwrap();

	// Find the files outside of the crate.
	let files = external_files(&app, &root).unwrap();
	let expected = [
		root.join("shared/message.txt"),
		root.join("shared/messages.rs"),
	];
	assert_eq!(files.into_iter().collect::<Vec<_>>(), expected);

	// A crate at the root of the Cargo source has nothing outside of it to include.
	assert!(external_files(&root, &root).unwrap().is_empty());
}

#[test]
fn external_files_skips_only_the_target_directory_of_the_crate() {
	let temp = tempfile::tempdir().unwrap();
	let root = temp.path().canonicalize().unwrap();
	let app = root.join("app");
	for (directory, name) in [("src/target", "module.txt"), ("target/src", "output.txt")] {
		std::fs::create_dir_all(app.join(directory)).unwrap();
		let contents = format!("include_str!(\"../../../{name}\");\n");
		std::fs::write(app.join(directory).join("mod.rs"), contents).unwrap();
		std::fs::write(root.join(name), "contents").unwrap();
	}
	let files = external_files(&app, &root).unwrap();
	assert_eq!(
		files.into_iter().collect::<Vec<_>>(),
		[root.join("module.txt")]
	);
}

#[test]
fn relative_path_climbs_to_the_common_ancestor() {
	let path = relative_path(
		Path::new("/opt/tangram/store/source/packages/python"),
		Path::new("/opt/tangram/tmp/sandbox/output/out"),
	);
	assert_eq!(path, PathBuf::from("../../../../tmp/sandbox/output/out"));
	let path = relative_path(Path::new("packages/python"), Path::new(".tgrustc-out-dir"));
	assert_eq!(path, PathBuf::from("../../.tgrustc-out-dir"));
}
