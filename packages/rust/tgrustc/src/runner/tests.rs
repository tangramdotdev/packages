use super::replace_rerun_paths;

#[test]
fn rerun_paths_name_the_source() {
	let stdout = "cargo:rerun-if-changed=/store/source/app/../shared\ncargo::rerun-if-changed=/store/source/app\ncargo:rerun-if-changed=build.rs\ncargo:rustc-link-search=/store/source/app/lib\ncargo:rerun-if-env-changed=VARIABLE";
	assert_eq!(
		replace_rerun_paths(stdout, "/store/source"),
		"cargo:rerun-if-changed=@@TGRUSTC_SOURCE@@/app/../shared\ncargo::rerun-if-changed=@@TGRUSTC_SOURCE@@/app\ncargo:rerun-if-changed=build.rs\ncargo:rustc-link-search=/store/source/app/lib\ncargo:rerun-if-env-changed=VARIABLE",
	);
}
