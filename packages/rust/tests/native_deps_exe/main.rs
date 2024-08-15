use bytes::Bytes;

fn main() {
	let bytes = Bytes::from("Hello using the bytes crate!");
	println!("{:?}", bytes);
}
