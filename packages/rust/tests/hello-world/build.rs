use std::io::Write;

const BUILD_TXT: &[u8] = include_bytes!("./assets/build.txt");
fn main() {
    let out_dir = std::env::var("OUT_DIR").unwrap();
    let out_file = std::path::PathBuf::from(out_dir).join("generated.txt");
    let mut out_file = std::fs::File::options()
        .read(true)
        .write(true)
        .create(true)
        .open(out_file)
        .unwrap();
    out_file.write_all(BUILD_TXT).unwrap();
}
