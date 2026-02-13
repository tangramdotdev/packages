fn main() {
	let output = include_str!(concat!(env!("OUT_DIR"), "/tool_output.txt"));
	print!("{output}");
}
