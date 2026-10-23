fn main() {
	let path = std::env::var("TANGRAM_CONFIG_MESSAGE").unwrap();
	let message = std::fs::read_to_string(path).unwrap();
	println!("cargo:rustc-env=TANGRAM_CONFIG_CONTENT={}", message.trim());
}
