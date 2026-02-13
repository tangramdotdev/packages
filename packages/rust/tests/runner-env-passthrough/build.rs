fn main() {
    // Reproduce the tangram_js/tangram_compiler build script pattern: check for
    // NODE_PATH and fail if it is missing. In the real tangram build, missing
    // NODE_PATH causes the build script to attempt creating a lock file outside
    // the workspace, which fails in the runner sandbox with PermissionDenied.
    println!("cargo:rerun-if-env-changed=NODE_PATH");

    let node_path = std::env::var("NODE_PATH")
        .expect("NODE_PATH must be set; the runner should pass it through");

    let out_dir = std::env::var("OUT_DIR").unwrap();
    let dest = std::path::Path::new(&out_dir).join("node_path.txt");
    std::fs::write(&dest, &node_path).unwrap();
}
