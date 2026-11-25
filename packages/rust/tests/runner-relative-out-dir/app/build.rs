use std::path::{Path, PathBuf};

fn main() {
	println!("cargo:rerun-if-changed=build.rs");

	// Write a file to the output directory, and export its path relative to the manifest directory.
	let manifest_directory = PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap());
	let output = PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
	std::fs::write(output.join("message.txt"), "hello from the output directory").unwrap();
	let relative = relative_path(&manifest_directory, &output.join("message.txt"));
	println!("cargo:rustc-env=MESSAGE_PATH={}", relative.display());
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
