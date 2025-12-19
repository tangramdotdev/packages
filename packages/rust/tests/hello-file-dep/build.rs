fn main() {
    // Watch this file for changes
    println!("cargo:rerun-if-changed=data/config.txt");

    let config = std::fs::read_to_string("data/config.txt").unwrap();
    let out_dir = std::env::var("OUT_DIR").unwrap();
    let dest = std::path::Path::new(&out_dir).join("config_embedded.txt");
    std::fs::write(&dest, &config).unwrap();
}
