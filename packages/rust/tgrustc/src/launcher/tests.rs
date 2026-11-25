use {
	super::{SCRIPT_NAME, install},
	crate::args::Args,
	std::{os::unix::fs::PermissionsExt as _, path::Path},
};

#[test]
fn launcher_is_a_new_file_that_runs_the_build_script() {
	// Install a launcher for a build script whose executable is as old as a file in the store.
	let directory = tempfile::tempdir().unwrap();
	let launcher = directory.path().join("build_script_build-0123");
	let script = directory.path().join(SCRIPT_NAME);
	write_executable(&launcher, "#!/bin/sh\nprintf '%s\\n' \"$@\"\n");
	std::fs::File::open(&launcher)
		.unwrap()
		.set_modified(std::time::UNIX_EPOCH)
		.unwrap();
	let args = Args {
		crate_name: Some("build_script_build".to_owned()),
		extra_filename: Some("-0123".to_owned()),
		out_dir: None,
		passthrough: Vec::new(),
		rustc: "rustc".to_owned(),
	};
	install(directory.path(), &args).unwrap();

	// Cargo compares the launcher's modification time with those of its dependencies, and replaces the launcher.
	let metadata = std::fs::symlink_metadata(&launcher).unwrap();
	assert!(metadata.is_file());
	assert!(!metadata.permissions().readonly());
	assert!(metadata.modified().unwrap() > std::time::UNIX_EPOCH);

	// Run the launcher without the proxy, and with a proxy whose path must be quoted.
	assert_eq!(run(&launcher, None), "an argument\n");
	let proxy = directory.path().join("the proxy's executable");
	std::fs::copy(&script, &proxy).unwrap();
	let expected = format!("runner\n{}\nan argument\n", script.display());
	assert_eq!(run(&launcher, Some(&proxy)), expected);
}

fn run(launcher: &Path, proxy: Option<&Path>) -> String {
	let mut command = std::process::Command::new(launcher);
	command
		.arg("an argument")
		.env_remove("TGRUSTC_PROXY_BUILD_SCRIPTS");
	if let Some(proxy) = proxy {
		command.env("TGRUSTC_PROXY_BUILD_SCRIPTS", proxy);
	}
	let output = command.output().unwrap();
	String::from_utf8(output.stdout).unwrap()
}

fn write_executable(path: &Path, contents: &str) {
	std::fs::write(path, contents).unwrap();
	let permissions = std::fs::Permissions::from_mode(0o755);
	std::fs::set_permissions(path, permissions).unwrap();
}
