fn main() {
    // This tells Cargo to rerun build.rs if MY_BUILD_VAR changes
    println!("cargo:rerun-if-env-changed=MY_BUILD_VAR");

    let value = std::env::var("MY_BUILD_VAR").unwrap_or_else(|_| "default".into());
    let out_dir = std::env::var("OUT_DIR").unwrap();
    let dest = std::path::Path::new(&out_dir).join("env_value.txt");
    std::fs::write(&dest, &value).unwrap();
}
