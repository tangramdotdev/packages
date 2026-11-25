// Include a file from outside of the crate's directory.
const MESSAGE: &str = include_str!("../../../shared/message.txt");

fn main() {
	print!("{MESSAGE}");
}
