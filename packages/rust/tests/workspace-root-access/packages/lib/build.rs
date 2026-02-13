use std::path::Path;

fn main() {
    // Access a file at the workspace root using relative paths, two levels up
    // from this crate. This pattern is used by tangram_js and tangram_compiler
    // build scripts, which read bun.lock, node_modules, and sibling packages
    // from the workspace root via relative paths like "../../bun.lock".
    let config_path = Path::new("../../shared-config.txt");

    println!("cargo:rerun-if-changed=../../shared-config.txt");

    let config = std::fs::read_to_string(config_path).unwrap_or_else(|e| {
        panic!(
            "Failed to read workspace config at {}: {e}",
            config_path.display()
        )
    });

    let out_dir = std::env::var("OUT_DIR").unwrap();
    let dest = Path::new(&out_dir).join("config.rs");
    std::fs::write(
        dest,
        format!("pub const SHARED_CONFIG: &str = {:?};\n", config.trim()),
    )
    .unwrap();
}
