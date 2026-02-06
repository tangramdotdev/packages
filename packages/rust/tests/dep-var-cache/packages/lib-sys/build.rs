fn main() {
    // Get the OUT_DIR which is a temp path during builds.
    let out_dir = std::env::var("OUT_DIR").unwrap();

    // Set cargo metadata that includes the temp path.
    // This becomes DEP_MYLIB_ROOT for dependent crates.
    // The bug: this temp path differs between builds, causing cache misses.
    println!("cargo:metadata=root={}", out_dir);

    // Also set a non-path value for comparison.
    println!("cargo:metadata=version=1.0.0");

    println!("cargo:rerun-if-changed=build.rs");
}
