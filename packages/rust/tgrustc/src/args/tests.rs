use super::Args;

#[test]
fn is_build_script_requires_an_executable() {
	for (crate_name, crate_type, expected) in [
		("build_script_build", "bin", true),
		("build_script_main", "bin", true),
		("build_script_utils", "lib", false),
		("build_script_utils", "proc-macro", false),
		("main", "bin", false),
	] {
		let args = Args {
			crate_name: Some(crate_name.to_owned()),
			extra_filename: None,
			out_dir: None,
			passthrough: vec!["--crate-type".to_owned(), crate_type.to_owned()],
			rustc: "rustc".to_owned(),
		};
		assert_eq!(
			args.is_build_script(),
			expected,
			"{crate_name} {crate_type}"
		);
	}
}
