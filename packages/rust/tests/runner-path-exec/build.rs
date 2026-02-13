fn main() {
	let output = std::process::Command::new("my-exec-tool")
		.output()
		.expect("should be able to execute my-exec-tool from PATH");
	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr);
		panic!("my-exec-tool failed: {stderr}");
	}
	let stdout = String::from_utf8_lossy(&output.stdout);
	let out_dir = std::env::var("OUT_DIR").unwrap();
	std::fs::write(
		std::path::Path::new(&out_dir).join("tool_output.txt"),
		stdout.as_ref(),
	)
	.unwrap();
}
