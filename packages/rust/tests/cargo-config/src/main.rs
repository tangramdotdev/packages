fn main() {
	assert!(cfg!(debug_assertions));
	let mut buffer = itoa::Buffer::new();
	println!(
		"{} {} {}",
		env!("TANGRAM_CONFIG_CONTENT"),
		env!("TANGRAM_CONFIG_OVERRIDE"),
		buffer.format(128),
	);
}
