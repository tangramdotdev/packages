use std::path::PathBuf;
use std::time::SystemTime;

fn main() {
    let out_dir = PathBuf::from(std::env::var_os("OUT_DIR").unwrap());

    // Write a timestamp to OUT_DIR. This is non-deterministic: each execution
    // produces different content, simulating build scripts like tangram_js that
    // create V8 heap snapshots (which vary across process invocations).
    let timestamp = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_nanos()
        .to_string();
    std::fs::write(out_dir.join("timestamp.txt"), &timestamp).unwrap();

    // Export the timestamp via cargo:rustc-env so the lib crate can use it.
    println!("cargo:rustc-env=LIB_BUILD_TIMESTAMP={timestamp}");
    println!("cargo:rerun-if-changed=build.rs");
}
