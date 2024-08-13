const HELLO_TXT: &[u8] = include_bytes!("../../assets/hello.txt");
pub fn hello() {
	println!("{}", std::str::from_utf8(HELLO_TXT).unwrap());
}
