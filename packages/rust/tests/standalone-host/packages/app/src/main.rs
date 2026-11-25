#[cfg(not(standalone_test))]
compile_error!("the caller's Rust flags must be preserved");

const GENERATED: &str =
	include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/", env!("GENERATED_PATH")));
const INCLUDED: &str = include_str!("../../../shared/included.txt");

fn main() {
	println!("{}, {GENERATED}, {}", message::message(), INCLUDED.trim());
}
