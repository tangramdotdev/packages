// Run the executable that Cargo names, which is its current build.
#[test]
fn program() {
	let output = std::process::Command::new(env!("CARGO_BIN_EXE_app"))
		.output()
		.unwrap();
	print!("{}", String::from_utf8(output.stdout).unwrap());
}
