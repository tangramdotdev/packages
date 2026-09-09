use {
	super::{Executable, Interpreter, LdLinuxInterpreter, LdMuslInterpreter, Manifest},
	std::collections::BTreeMap,
	tangram_client::prelude::*,
};

#[test]
fn dependencies_retain_tokens() {
	let file = file_with_token(100);
	let template = crate::template_from_artifact(file.clone().into()).to_data();
	let value = tg::value::Data::Object(file.to_referent().map(Into::into));
	let value = tg::value::Data::Map(BTreeMap::from([("file".to_owned(), value)]));
	let mut dependencies = BTreeMap::new();
	super::collect_dependencies_from_template_data(&template, &mut dependencies);
	super::collect_dependencies_from_value_data(&value, &mut dependencies);
	super::collect_dependencies_from_template_data(
		&template.without_location_and_tokens(),
		&mut dependencies,
	);
	assert_eq!(dependencies.len(), 1);
	let dependency = dependencies.values().next().unwrap().as_ref().unwrap();
	let object = dependency.0.node.as_ref().unwrap();
	assert_eq!(object.id(), file.id().into());
	assert_eq!(object.state().tokens(), file.state().tokens());

	let mut dependencies = BTreeMap::new();
	super::collect_dependencies_from_value_data(&value, &mut dependencies);
	let dependency = dependencies.values().next().unwrap().as_ref().unwrap();
	let object = dependency.0.node.as_ref().unwrap();
	assert_eq!(object.state().tokens(), file.state().tokens());
}

#[tokio::test]
async fn inherit_from_file_does_not_use_parent_node_token_for_dependencies() {
	use tg::authorization::permission::object::Permission::{Node, Subtree};
	tg::init().unwrap();
	for permission in [None, Some(Node), Some(Subtree)] {
		let file = tg::File::with_contents("manifest dependency");
		if let Some(permission) = permission {
			set_file_token_with_permission(&file, 100, permission);
		}
		let expected = file.state().tokens();
		let mut manifest = Manifest {
			executable: Executable::Path(
				crate::template_from_artifact(file.clone().into()).to_data(),
			),
			args: None,
			env: None,
			interpreter: None,
		};
		let wrapper = tg::File::builder()
			.contents("wrapper")
			.dependencies(manifest.dependencies())
			.build()
			.unwrap();
		set_file_token_with_permission(&wrapper, 200, Node);
		manifest = manifest.without_location_and_tokens();
		manifest.inherit_from_file(&wrapper).await.unwrap();
		let dependencies = manifest.dependencies();
		let dependency = dependencies.values().next().unwrap().as_ref().unwrap();
		let tokens = dependency.0.node.as_ref().unwrap().state().tokens();
		assert_eq!(
			tokens, expected,
			"a wrapper node token cannot authorize its child"
		);
	}
}

#[test]
fn dependencies_merge_tokens_from_multiple_locations() {
	let local = file_with_token(200);
	let remote = file_with_token(100);
	let location = tg::Location::Remote(tg::location::Remote {
		name: "test".to_owned(),
		region: None,
	});
	let mut tokens = tg::authorization::Tokens::default();
	tokens.set(
		location.clone(),
		remote.state().tokens().local().unwrap().clone(),
	);
	remote.state().set_tokens(tokens);
	let mut dependencies = BTreeMap::new();
	for file in [local, remote] {
		let template = crate::template_from_artifact(file.into()).to_data();
		super::collect_dependencies_from_template_data(&template, &mut dependencies);
	}
	let dependency = dependencies.values().next().unwrap().as_ref().unwrap();
	let tokens = dependency.0.node.as_ref().unwrap().state().tokens();
	assert_eq!(tokens.iter().count(), 2);
	assert_eq!(tokens.local().unwrap().body.expires_at, 200);
	assert_eq!(tokens.get(&location).unwrap().body.expires_at, 100);
}

#[test]
fn ld_linux_argument_dependencies_retain_tokens() {
	let file = file_with_token(100);
	let interpreter = Interpreter::LdLinux(LdLinuxInterpreter {
		path: tg::Template::from("/lib/ld-linux.so").to_data(),
		args: Some(vec![
			crate::template_from_artifact(file.clone().into()).to_data(),
		]),
		library_paths: None,
		preloads: None,
	});
	assert_argument_dependency(interpreter, &file);
}

#[test]
fn ld_musl_argument_dependencies_retain_tokens() {
	let file = file_with_token(100);
	let interpreter = Interpreter::LdMusl(LdMuslInterpreter {
		path: tg::Template::from("/lib/ld-musl.so").to_data(),
		args: Some(vec![
			crate::template_from_artifact(file.clone().into()).to_data(),
		]),
		library_paths: None,
		preloads: None,
	});
	assert_argument_dependency(interpreter, &file);
}

fn assert_argument_dependency(interpreter: Interpreter, file: &tg::File) {
	let manifest = Manifest {
		interpreter: Some(interpreter),
		executable: Executable::Content(tg::Template::from("echo").to_data()),
		env: None,
		args: None,
	};
	let dependencies = manifest.dependencies();
	let reference = tg::Reference::with_object(file.id().into());
	let dependency = dependencies
		.get(&reference)
		.expect("missing loader argument dependency");
	let object = dependency.as_ref().unwrap().0.node.as_ref().unwrap();
	assert_eq!(object.state().tokens(), file.state().tokens());
}

#[tokio::test]
#[ignore = "requires a running Tangram server"]
async fn read_from_file_restores_dependency_tokens() {
	tg::init().unwrap();
	let mut files = Vec::new();
	for index in 0..7 {
		let file = tg::File::with_contents(format!("round trip dependency {index}"));
		file.store().await.unwrap();
		assert!(!file.state().tokens().is_empty());
		files.push(file);
	}
	let template =
		|index: usize| crate::template_from_artifact(files[index].clone().into()).to_data();
	let manifest = Manifest {
		interpreter: Some(Interpreter::LdLinux(LdLinuxInterpreter {
			path: template(0),
			args: Some(vec![template(1)]),
			library_paths: Some(vec![template(2)]),
			preloads: Some(vec![template(3)]),
		})),
		executable: Executable::Path(template(4)),
		args: Some(vec![template(5)]),
		env: Some(tg::mutation::Data::Merge {
			value: BTreeMap::from([(
				"FILE".to_owned(),
				tg::value::Data::Object(files[6].to_referent().map(Into::into)),
			)]),
		}),
	};
	let wrapper = stored_manifest_file(&manifest, &files).await;
	// Also exercise checkout/checkin, the path used by tgstrip to recover the original wrapper.
	let checkout = tempfile::TempDir::new().unwrap();
	let path = checkout.path().join("wrapper");
	crate::checkout_artifact_to_path(wrapper.clone().into(), path.clone())
		.await
		.unwrap();
	let checked_in = tg::checkin(tg::checkin::Arg {
		options: tg::checkin::Options {
			root: true,
			lock: None,
			..Default::default()
		},
		path,
		updates: Vec::new(),
	})
	.await
	.unwrap()
	.try_unwrap_file()
	.unwrap();
	// A cached dependency may still carry an older token than its owning wrapper.
	set_file_token(&files[0], 100);
	for wrapper in [
		wrapper.clone(),
		tg::File::with_referent(wrapper.to_referent()),
		checked_in,
	] {
		let owner_body = wrapper.state().tokens().local().unwrap().body.clone();
		assert!(
			owner_body.grants(tg::authorization::Permission::Object(
				tg::authorization::permission::object::Permission::Subtree,
			)),
			"the refresh fixture requires a wrapper subtree token"
		);
		let restored = Manifest::read_from_file(wrapper).await.unwrap().unwrap();
		let restored_dependencies = restored.dependencies();
		for file in &files {
			let reference = tg::Reference::with_object(file.id().into());
			let dependency = restored_dependencies
				.get(&reference)
				.expect("missing restored dependency");
			let object = dependency.as_ref().unwrap().0.node.as_ref().unwrap();
			assert!(
				!object.state().tokens().is_empty(),
				"missing authorization for {}",
				file.id()
			);
			assert!(
				object
					.state()
					.tokens()
					.local()
					.unwrap()
					.body
					.validate_at(
						std::time::SystemTime::now()
							.duration_since(std::time::UNIX_EPOCH)
							.unwrap()
							.as_secs()
							.try_into()
							.unwrap()
					)
					.is_ok(),
				"restored dependency authorization must be valid",
			);
			object.object().await.unwrap();
		}
	}
}

async fn stored_manifest_file(manifest: &Manifest, files: &[tg::File]) -> tg::File {
	let temp = tempfile::NamedTempFile::new().unwrap();
	std::fs::copy(std::env::current_exe().unwrap(), temp.path()).unwrap();
	manifest.write_to_path(temp.path()).unwrap();
	let bytes_only = Manifest::read_from_path(temp.path()).unwrap().unwrap();
	for dependency in bytes_only.dependencies().values().flatten() {
		assert!(
			dependency
				.0
				.node
				.as_ref()
				.unwrap()
				.state()
				.tokens()
				.is_empty()
		);
	}
	// Check in the bytes to obtain a subtree token for the contents. Blob::with_reader returns
	// only an ID, which can cause the wrapper to receive a node-only token when it is stored.
	let contents = tg::checkin(tg::checkin::Arg {
		options: tg::checkin::Options {
			root: true,
			lock: None,
			..Default::default()
		},
		path: temp.path().to_owned(),
		updates: Vec::new(),
	})
	.await
	.unwrap()
	.try_unwrap_file()
	.unwrap()
	.contents()
	.await
	.unwrap();
	// Supply all dependencies explicitly so this test isolates the read path from collection.
	let dependencies: BTreeMap<_, _> = files
		.iter()
		.map(|file| {
			(
				tg::Reference::with_object(file.id().into()),
				Some(tg::file::Dependency(tg::Referent::with_node(Some(
					file.clone().into(),
				)))),
			)
		})
		.collect();
	let wrapper = tg::File::builder()
		.contents(contents)
		.dependencies(dependencies)
		.build()
		.unwrap();
	wrapper.store().await.unwrap();
	wrapper
}

#[test]
fn serialized_manifest_ignores_token_expiration() {
	let first = manifest_with_token(100);
	let second = manifest_with_token(200);
	let first_data = first.clone().without_location_and_tokens();
	let second_data = second.without_location_and_tokens();
	assert_eq!(
		serde_json::to_vec(&first_data).unwrap(),
		serde_json::to_vec(&second_data).unwrap(),
	);
	for dependency in first_data.dependencies().values().flatten() {
		let object = dependency.0.node.as_ref().unwrap();
		assert!(object.state().tokens().is_empty());
	}
	for dependency in first.dependencies().values().flatten() {
		let object = dependency.0.node.as_ref().unwrap();
		assert!(!object.state().tokens().is_empty());
	}
}

fn manifest_with_token(expires_at: i64) -> Manifest {
	let file = file_with_token(expires_at);
	let template = crate::template_from_artifact(file.clone().into()).to_data();
	let interpreter = LdLinuxInterpreter {
		args: Some(vec![template.clone()]),
		library_paths: Some(vec![template.clone()]),
		path: template.clone(),
		preloads: Some(vec![template.clone()]),
	};
	let value = tg::value::Data::Object(file.to_referent().map(Into::into));
	let env = tg::mutation::Data::Merge {
		value: BTreeMap::from([("file".to_owned(), value)]),
	};
	Manifest {
		args: Some(vec![template.clone()]),
		env: Some(env),
		executable: Executable::Path(template),
		interpreter: Some(Interpreter::LdLinux(interpreter)),
	}
}

fn file_with_token(expires_at: i64) -> tg::File {
	let file = tg::File::with_contents("manifest dependency");
	set_file_token(&file, expires_at);
	file
}

fn set_file_token(file: &tg::File, expires_at: i64) {
	set_file_token_with_permission(
		file,
		expires_at,
		tg::authorization::permission::object::Permission::Subtree,
	);
}

fn set_file_token_with_permission(
	file: &tg::File,
	expires_at: i64,
	permission: tg::authorization::permission::object::Permission,
) {
	let body = tg::authorization::Body {
		expires_at,
		permissions: vec![tg::authorization::Permission::Object(permission)],
		resource: file.id().into(),
	};
	let key = tg::authorization::PrivateKey::new(
		"test",
		tg::authorization::Algorithm::Ed25519,
		vec![0; 32],
	);
	let token = tg::authorization::Token::sign(body, &key).unwrap();
	file.state()
		.set_tokens(tg::authorization::Tokens::with_local(Some(token)));
}
