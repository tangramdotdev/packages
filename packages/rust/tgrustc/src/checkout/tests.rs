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
