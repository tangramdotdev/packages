use {
	super::{Executable, Interpreter, LdLinuxInterpreter, LdMuslInterpreter, Manifest},
	std::collections::BTreeMap,
	tangram_client::prelude::*,
};

#[test]
fn interpreter_and_environment_dependencies_preserve_authorization() {
	let local = file_with_token(100);
	let remote = file_with_token(200);
	let location = tg::Location::Remote(tg::location::Remote {
		name: "test".to_owned(),
		region: None,
	});
	let mut tokens = tg::authorization::Tokens::default();
	tokens.insert(location, remote.state().tokens().local()[0].clone());
	remote.state().set_tokens(tokens);
	let mut expected = local.state().tokens();
	expected.inherit(&remote.state().tokens());
	let template = crate::template_from_artifact(local.into()).to_data();
	for interpreter in [
		Interpreter::LdLinux(LdLinuxInterpreter {
			path: tg::Template::from("/lib/ld-linux.so").to_data(),
			args: Some(vec![template.clone()]),
			library_paths: None,
			preloads: None,
		}),
		Interpreter::LdMusl(LdMuslInterpreter {
			path: tg::Template::from("/lib/ld-musl.so").to_data(),
			args: Some(vec![template.clone()]),
			library_paths: None,
			preloads: None,
		}),
	] {
		let manifest = Manifest {
			interpreter: Some(interpreter),
			executable: Executable::Content(tg::Template::from("echo").to_data()),
			env: Some(tg::mutation::Data::Merge {
				value: BTreeMap::from([(
					"file".to_owned(),
					tg::value::Data::Object(remote.to_referent().map(Into::into)),
				)]),
			}),
			args: None,
		};
		let mut dependencies = manifest.dependencies();
		// A later bare reference must not erase the authorization already collected.
		super::collect_dependencies_from_template_data(
			&template.clone().without_location_and_tokens(),
			&mut dependencies,
		);
		assert_eq!(dependencies.len(), 1);
		let reference = tg::Reference::with_object(remote.id().into());
		let object = dependencies[&reference]
			.as_ref()
			.unwrap()
			.0
			.node
			.as_ref()
			.unwrap();
		assert_eq!(object.state().tokens(), expected);
	}
}

#[tokio::test]
async fn serialized_manifest_omits_credentials_and_can_restore_dependencies() {
	tg::init().unwrap();
	let manifest = manifest_with_token(100);
	let wrapper = tg::File::builder()
		.contents("wrapper")
		.dependencies(manifest.dependencies())
		.build()
		.unwrap();
	let mut serialized = manifest.clone().without_location_and_tokens();
	assert_eq!(
		serde_json::to_vec(&serialized).unwrap(),
		serde_json::to_vec(&manifest_with_token(200).without_location_and_tokens()).unwrap(),
	);
	for dependency in serialized.dependencies().values().flatten() {
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
	serialized.inherit_from_file(&wrapper).await.unwrap();
	let restored = serialized.dependencies();
	for (reference, dependency) in manifest.dependencies() {
		let expected = dependency.unwrap().0.node.unwrap();
		let actual = restored[&reference]
			.as_ref()
			.unwrap()
			.0
			.node
			.as_ref()
			.unwrap();
		assert_eq!(actual.state().tokens(), expected.state().tokens());
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
	let token = tg::authorization::Token {
		body: tg::authorization::Body {
			expires_at,
			permissions: vec![tg::authorization::Permission::Object(
				tg::authorization::permission::object::Permission::Subtree,
			)],
			resource: file.id().into(),
		},
		metadata: tg::authorization::Metadata {
			algorithm: tg::authorization::Algorithm::Ed25519,
			key: "test".into(),
		},
		signature: vec![0; 64],
	};
	file.state()
		.set_tokens(tg::authorization::Tokens::with_local([token]));
	file
}
