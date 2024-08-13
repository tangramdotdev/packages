use bytes::Bytes;
use greeting::GREETING;

fn main() {
	let b = Bytes::from(GREETING);
	println!("{}", String::from_utf8_lossy(&b));
}
