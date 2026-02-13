fn main() {
    // Verify that my-tool is available on PATH via $NODE_PATH/.bin.
    // This reproduces the tangram_js build script pattern where tools like
    // tsgo and oxlint are found in node_modules/.bin (a subpath of NODE_PATH).
    //
    // Instead of executing the tool (which requires /bin/sh in the sandbox),
    // we resolve and read it through the symlink. This tests the same thing:
    // the runner must express .bin as a subpath of the checked-in NODE_PATH
    // directory so that the symlink .bin/my-tool -> ../my-tool-pkg/tool.sh
    // resolves correctly.
    println!("cargo:rerun-if-env-changed=NODE_PATH");

    let path_var = std::env::var("PATH").unwrap_or_default();
    let mut found = None;
    for dir in path_var.split(':') {
        let candidate = std::path::Path::new(dir).join("my-tool");
        if candidate.exists() {
            found = Some(candidate);
            break;
        }
    }
    let tool_path = found.expect("my-tool should be found on PATH");

    // Follow the symlink and read the target file. This fails if the symlink
    // target (../my-tool-pkg/tool.sh) does not resolve, which is the exact
    // bug this test guards against.
    let contents =
        std::fs::read_to_string(&tool_path).expect("should be able to read my-tool through symlink");

    let out_dir = std::env::var("OUT_DIR").unwrap();
    let dest = std::path::Path::new(&out_dir).join("tool_output.txt");
    std::fs::write(&dest, &contents).unwrap();
}
