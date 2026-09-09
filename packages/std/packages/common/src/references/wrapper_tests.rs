use super::*;
use std::os::unix::process::CommandExt as _;
use xattr::FileExt as _;

#[tokio::test]
#[ignore = "requires a server, TANGRAM_INJECTION_IDENTITY_PATH, and COMMON_TEST_DEPENDENCY_ID"]
async fn unrender_loads_checked_out_dependency_from_server() {
	tg::init().unwrap();
	let id = std::env::var("COMMON_TEST_DEPENDENCY_ID").unwrap();
	let references = References::default();
	references.retain_from_current_executable().unwrap();
	let template = references
		.unrender(&format!("/opt/tangram/store/{id}"))
		.await
		.expect("the checkout must authorize the unrendered dependency");
	let restored = tg::Template::try_from_data(template.to_data()).unwrap();
	let artifact = restored.artifacts().next().unwrap();
	assert_eq!(artifact.id().to_string(), id);
	assert!(!artifact.state().tokens().is_empty());
	artifact
		.load()
		.await
		.expect("the recovered token must authorize a real object request");
}

#[tokio::test]
async fn unrender_recovers_wrapper_authorization_in_child_process() {
	let dependency = super::tests::authorized_file();
	if std::env::var_os("COMMON_TEST_WRAPPER_CHILD").is_some() {
		tg::init().unwrap();
		let references = References::default();
		references.retain_from_current_executable().unwrap();
		// The recovered token must avoid a request to the unavailable server.
		let template = references
			.unrender(&format!("/opt/tangram/store/{}", dependency.id()))
			.await
			.expect("the exec boundary must retain the wrapper's dependency authorization");
		assert_eq!(
			template.artifacts().next().unwrap().state().tokens(),
			dependency.state().tokens()
		);
		return;
	}
	let directory = tempfile::tempdir().unwrap();
	let wrapper = tempfile::NamedTempFile::new_in(directory.path()).unwrap();
	let reference = tg::Reference::with_node_and_tokens(
		tg::reference::Node::Id(dependency.id().into()),
		dependency.state().tokens(),
	);
	let attribute = tg::file::dependencies_xattrs(&[reference], usize::MAX)
		.unwrap()
		.remove(0);
	wrapper
		.as_file()
		.set_xattr(attribute.name, &attribute.value)
		.unwrap();
	let executable = std::env::current_exe().unwrap();
	let empty = tempfile::NamedTempFile::new_in(directory.path()).unwrap();
	for attribute in tg::file::dependencies_xattrs(&[], usize::MAX).unwrap() {
		empty
			.as_file()
			.set_xattr(attribute.name, &attribute.value)
			.unwrap();
	}
	let unrelated = tempfile::NamedTempFile::new_in(directory.path()).unwrap();
	let reference = tg::Reference::with_object(tg::File::with_contents("unrelated").id().into());
	for attribute in tg::file::dependencies_xattrs(&[reference], usize::MAX).unwrap() {
		unrelated
			.as_file()
			.set_xattr(attribute.name, &attribute.value)
			.unwrap();
	}
	let name = wrapper.path().file_name().unwrap();
	for (arg0, identity) in [
		(empty.path().to_owned(), Some(wrapper.path())),
		(unrelated.path().to_owned(), Some(wrapper.path())),
		("missing-wrapper".into(), Some(wrapper.path())),
		(executable.clone(), Some(wrapper.path())),
		(wrapper.path().to_owned(), None),
		(std::path::Path::new(".").join(name), None),
		(std::path::PathBuf::from(name), None),
		(wrapper.path().to_owned(), Some(executable.as_path())),
	] {
		let mut command = std::process::Command::new(&executable);
		command
			.arg0(&arg0)
			.args([
				"--exact",
				"references::wrapper_tests::unrender_recovers_wrapper_authorization_in_child_process",
				"--nocapture",
			])
			.current_dir(directory.path())
			.env("PATH", directory.path())
			.env("COMMON_TEST_WRAPPER_CHILD", "1")
			.env_remove("TANGRAM_INJECTION_IDENTITY_PATH")
			.env(
				"TANGRAM_URL",
				"http+unix://%2Fnonexistent-common-authorization-test.sock",
			);
		if let Some(identity) = identity {
			command.env("TANGRAM_INJECTION_IDENTITY_PATH", identity);
		}
		let output = command.output().unwrap();
		assert!(
			output.status.success(),
			"arg0={arg0:?}, identity={identity:?}\n{}\n{}",
			String::from_utf8_lossy(&output.stdout),
			String::from_utf8_lossy(&output.stderr)
		);
	}
}

#[tokio::test]
async fn unrender_recovers_checked_out_wrapper_dependencies() {
	let dependency = super::tests::authorized_file();
	let location = tg::Location::Remote(tg::location::Remote {
		name: "retained".into(),
		region: None,
	});
	let reference = tg::Reference::with_node_and_options(
		tg::reference::Node::Id(dependency.id().into()),
		tg::reference::Options {
			location: Some(location.clone().into()),
			tokens: dependency.state().tokens(),
			..Default::default()
		},
	);
	for shard_size in [usize::MAX, 32] {
		let wrapper = tempfile::NamedTempFile::new().unwrap();
		for attribute in
			tg::file::dependencies_xattrs(std::slice::from_ref(&reference), shard_size).unwrap()
		{
			wrapper
				.as_file()
				.set_xattr(attribute.name, &attribute.value)
				.unwrap();
		}
		// Resolve through a symlink, just as a compiler can invoke its linker.
		let directory = tempfile::tempdir().unwrap();
		let path = directory.path().join("ld");
		std::os::unix::fs::symlink(wrapper.path(), &path).unwrap();
		let references = References::default();
		references.retain_from_wrapper(&path).unwrap();
		let template = references
			.unrender(&format!("/opt/tangram/store/{}", dependency.id()))
			.await
			.expect("the wrapper's dependency token must avoid the exhausted lookup");
		let restored = tg::Template::try_from_data(template.to_data()).unwrap();
		let artifact = restored.artifacts().next().unwrap();
		assert_eq!(artifact.state().tokens(), dependency.state().tokens());
		assert_eq!(artifact.state().location(), Some(location.clone()));
	}
}

#[test]
fn wrapper_without_dependency_attributes_is_supported() {
	let executable = tempfile::NamedTempFile::new().unwrap();
	let references = References::default();
	references.retain_from_wrapper(executable.path()).unwrap();
	assert!(references.artifacts.lock().unwrap().is_empty());
}

#[test]
fn incomplete_wrapper_dependency_attributes_are_rejected() {
	let executable = tempfile::NamedTempFile::new().unwrap();
	executable
		.as_file()
		.set_xattr(format!("{}.1", tg::file::DEPENDENCIES_XATTR_NAME), b"[]")
		.unwrap();
	let references = References::default();
	assert!(references.retain_from_wrapper(executable.path()).is_err());
}

#[tokio::test]
async fn unrender_preserves_wrapper_tokens_without_interpreting_permissions() {
	use tg::authorization::permission::object::Permission::{Node, Subtree};
	let dependency = tg::File::with_contents("injection library");
	let parent = super::tests::authorized_file();
	let key = tg::authorization::PrivateKey::new(
		"test",
		tg::authorization::Algorithm::Ed25519,
		vec![0; 32],
	);
	for permission in [Subtree, Node] {
		let token = tg::authorization::Token::sign(
			tg::authorization::Body {
				expires_at: 2_000_000_000,
				permissions: vec![tg::authorization::Permission::Object(permission)],
				resource: parent.id().into(),
			},
			&key,
		)
		.unwrap();
		let wrapper = tempfile::NamedTempFile::new().unwrap();
		wrapper
			.as_file()
			.set_xattr(tg::file::TOKEN_XATTR_NAME, token.to_string().as_bytes())
			.unwrap();
		let reference = tg::Reference::with_object(dependency.id().into());
		let attribute = tg::file::dependencies_xattrs(&[reference], usize::MAX)
			.unwrap()
			.remove(0);
		wrapper
			.as_file()
			.set_xattr(attribute.name, &attribute.value)
			.unwrap();
		let references = References::default();
		references.retain_from_wrapper(wrapper.path()).unwrap();
		// The client forwards tokens; the server decides whether they authorize a request.
		let template = references
			.unrender(&format!("/opt/tangram/store/{}", dependency.id()))
			.await
			.expect("the unrendered dependency retains the wrapper token");
		assert_eq!(
			template
				.artifacts()
				.next()
				.unwrap()
				.state()
				.tokens()
				.local(),
			Some(&token)
		);
	}
}
