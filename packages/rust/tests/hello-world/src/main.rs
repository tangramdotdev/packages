mod nested;

const GENERATED_TXT: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/generated.txt"));
fn main() {
	// Change
	nested::hello();
	let mut buffer = itoa::Buffer::new();
	let printed = buffer.format(128u64);
	println!("{printed}");

	let generated = std::str::from_utf8(GENERATED_TXT).unwrap();
	println!("{generated}");
}
