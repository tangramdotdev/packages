const TOOL_OUTPUT: &str = include_str!(concat!(env!("OUT_DIR"), "/tool_output.txt"));

fn main() {
    print!("{TOOL_OUTPUT}");
}
