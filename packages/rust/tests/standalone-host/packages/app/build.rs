use std::path::{Path, PathBuf};

fn main() {
	println!("cargo:rerun-if-changed=build.rs");

	// Find a file of the workspace from outside of the crate, and watch it by its absolute path.
	let manifest_directory = PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap());
	let path = manifest_directory.join("../../shared/included.txt");
	println!("cargo:rerun-if-changed={}", path.display());
	assert!(path.is_file());

	// Read a file of the workspace that Cargo's configuration names by its absolute path, and watch it.
	let path = PathBuf::from(std::env::var_os("READ_PATH").unwrap());
	println!("cargo:rerun-if-changed={}", path.display());
	let contents = std::fs::read_to_string(path).unwrap();

	// Write a file to a new directory in the output directory, and export its path relative to the manifest directory.
	let output = PathBuf::from(std::env::var_os("OUT_DIR").unwrap()).join("nested");
	std::fs::create_dir_all(&output).unwrap();
	let file = output.join("generated.txt");
	std::fs::write(&file, codegen::generate(&contents)).unwrap();
	let relative = relative_path(&manifest_directory, &file);
	println!("cargo:rustc-env=GENERATED_PATH={}", relative.display());
}

fn relative_path(from: &Path, to: &Path) -> PathBuf {
	let common = from
		.components()
		.zip(to.components())
		.take_while(|(left, right)| left == right)
		.count();
	let mut path = PathBuf::new();
	for _ in from.components().skip(common) {
		path.push("..");
	}
	for component in to.components().skip(common) {
		path.push(component);
	}
	path
}
