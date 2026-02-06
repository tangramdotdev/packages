fn main() {
    // Compile a simple C library.
    cc::Build::new()
        .file("src/wrapper.c")
        .compile("wrapper");

    // Set cargo:root to OUT_DIR, which will become DEP_WRAPPER_ROOT for dependents.
    // This is the pattern used by lz4-sys, zstd-sys, and similar crates.
    let out_dir = std::env::var("OUT_DIR").unwrap();
    println!("cargo:root={out_dir}");

    // Also set cargo:rustc-link-search so dependents can find the library.
    // This adds -L native=<OUT_DIR> to rustc args for crates that link to us.
    println!("cargo:rustc-link-search=native={out_dir}");
}
