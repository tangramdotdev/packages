use super::*;

#[test]
fn references_in_the_proxys_installation() {
	let id = tg::File::with_contents("file").id().to_string();
	for installation in ["/var/lib/tangram", "/home/user/custom data"] {
		for directory in ["store", "checkouts"] {
			let executable = PathBuf::from(format!("{installation}/{directory}/{id}"));
			let pattern = artifact_reference_pattern(&executable).unwrap();
			let reference = format!("{installation}/store/{id}");
			let arg = format!("linker={reference}");
			assert_eq!(pattern.find(&arg).unwrap().as_str(), reference);
			assert!(pattern.find(&format!("/unrelated/store/{id}")).is_none());
		}
	}
}
