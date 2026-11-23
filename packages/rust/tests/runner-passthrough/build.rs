fn main() {
	println!("cargo:rerun-if-changed=build.rs");
	// The runner's sandbox does not receive Cargo's home, so its presence shows that this build script runs directly.
	assert!(
		std::env::var_os("CARGO_HOME").is_some(),
		"expected the build script to run directly"
	);
	println!("cargo:rustc-env=RUNNER_PASSTHROUGH_MESSAGE=ran directly");
}
