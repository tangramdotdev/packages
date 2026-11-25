use super::*;

#[test]
fn writable_outputs_preserve_cached_files_and_dependencies() {
	let directory = tempfile::tempdir().unwrap();
	let source = directory.path().join("cached");
	let target = directory.path().join("output");
	fs::create_dir_all(source.join("nested")).unwrap();
	let file = source.join("nested/generated.rs");
	fs::write(&file, "cached contents").unwrap();
	let reference = tg::File::with_contents("dependency")
		.id()
		.to_string()
		.parse()
		.unwrap();
	let references = [reference];
	let arg = tg::file::xattrs::Arg {
		dependencies: Some(&references),
		required: &[],
		token: None,
	};
	tg::file::xattrs::write(&file, arg, tg::file::xattrs::Options::default()).unwrap();
	fs::set_permissions(&file, fs::Permissions::from_mode(0o444)).unwrap();
	copy(&source, &target, &source, directory.path()).unwrap();
	let output = target.join("nested/generated.rs");
	assert_eq!(
		tg::file::xattrs::read(&output).unwrap().dependencies,
		Some(references.to_vec())
	);
	fs::write(&output, "edited contents").unwrap();
	fs::write(target.join("nested/new.rs"), "new contents").unwrap();
	assert_eq!(fs::read_to_string(&file).unwrap(), "cached contents");
}

#[test]
fn output_symlinks_keep_local_targets_and_cached_dependencies() {
	let directory = tempfile::tempdir().unwrap();
	let store = directory.path().join("store");
	let source = store.join("output");
	let target = directory.path().join("cargo");
	fs::create_dir_all(source.join("nested")).unwrap();
	fs::write(store.join("dependency"), "dependency").unwrap();
	fs::write(source.join("generated"), "generated").unwrap();
	std::os::unix::fs::symlink("../generated", source.join("nested/local")).unwrap();
	std::os::unix::fs::symlink("../../dependency", source.join("nested/external")).unwrap();
	copy(&source, &target, &source, &store).unwrap();
	assert_eq!(
		fs::read_link(target.join("nested/local")).unwrap(),
		Path::new("../generated")
	);
	assert_eq!(
		fs::read_to_string(target.join("nested/external")).unwrap(),
		"dependency"
	);
	fs::write(target.join("generated"), "edited").unwrap();
	assert_eq!(
		fs::read_to_string(target.join("nested/local")).unwrap(),
		"edited"
	);
}

#[test]
fn copied_directories_do_not_follow_old_output_symlinks() {
	let directory = tempfile::tempdir().unwrap();
	let source = directory.path().join("source");
	let cached = directory.path().join("cached");
	let target = directory.path().join("output");
	fs::create_dir_all(source.join("nested")).unwrap();
	fs::create_dir_all(&cached).unwrap();
	fs::create_dir_all(&target).unwrap();
	fs::write(source.join("nested/generated"), "new output").unwrap();
	fs::write(cached.join("generated"), "cached dependency").unwrap();
	std::os::unix::fs::symlink(&cached, target.join("nested")).unwrap();
	copy(&source, &target, &source, directory.path()).unwrap();
	assert_eq!(
		fs::read_to_string(cached.join("generated")).unwrap(),
		"cached dependency"
	);
	assert_eq!(
		fs::read_to_string(target.join("nested/generated")).unwrap(),
		"new output"
	);
}

#[test]
fn only_the_outputs_of_a_compilation_link_the_store() {
	let directory = tempfile::tempdir().unwrap();
	let store = directory.path().join("store");
	let source = store.join("output");
	fs::create_dir_all(&source).unwrap();
	fs::write(source.join("generated"), "generated").unwrap();

	// Link the store beside the outputs of a compilation, and again when the compilation runs again.
	let target = directory.path().join("compilation");
	for _ in 0..2 {
		install(&source, &target, &store, false).unwrap();
		assert_eq!(fs::read_link(target.join(".tangram/store")).unwrap(), store);
		assert!(target.join("generated").is_file());
	}

	// Replace an `OUT_DIR`, including a link to the store that it holds, without changing the store.
	install(&source, &target, &store, true).unwrap();
	assert!(fs::symlink_metadata(target.join(".tangram")).is_err());
	assert!(target.join("generated").is_file());
	assert!(source.join("generated").is_file());
}
