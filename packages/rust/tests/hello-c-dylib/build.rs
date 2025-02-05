fn main() {
    // Look for the library using pkg-config
    pkg_config::probe_library("external")
        .unwrap_or_else(|e| panic!("Failed to find external library: {}", e));
}
