use super::*;

#[tokio::test]
async fn manifest_unrender_retains_authorization() {
	let directory = authorized_directory();
	let location = directory.state().location();
	let root = format!("/opt/tangram/store/{}", directory.id());
	let mut options = Options {
		additional_library_candidate_paths: vec![],
		command_path: "ld".into(),
		command_args: vec![],
		disallow_missing: true,
		embed: false,
		interpreter_path: Some(format!("{root}/ld-linux.so")),
		interpreter_args: Some(vec![format!("--argument={root}/argument")]),
		injection_path: Some(format!("{root}/preload")),
		library_path_strategy: LibraryPathStrategy::None,
		library_paths: vec![root],
		max_depth: MAX_DEPTH,
		output_path: "unused".into(),
		passthrough: false,
		wrapper_arg_value: None,
		wrapper_env_value: None,
	};
	for source in [
		"library path",
		"wrapper argument",
		"wrapper environment",
		"directory cache",
	] {
		let template = common::template_from_artifact(directory.clone().into()).to_data();
		options.wrapper_arg_value = (source == "wrapper argument").then(|| vec![template]);
		options.wrapper_env_value =
			(source == "wrapper environment").then(|| tg::mutation::Data::Merge {
				value: BTreeMap::from([(
					"LIBRARY".into(),
					tg::value::Data::Object(directory.to_referent().map(Into::into)),
				)]),
			});
		let cache = DirectoryCache {
			references: references_from_options(&options).unwrap(),
			..Default::default()
		};
		if source == "directory cache" {
			cache.intern(&directory);
		}
		let paths = (source == "library path").then(|| {
			HashSet::<_, Hasher>::from_iter([DirectoryWithSubpath {
				directory: directory.clone(),
				subpath: None,
			}])
		});
		let manifest = create_manifest(
			tg::File::with_contents("executable").into(),
			&options,
			InterpreterRequirement::Default(InterpreterFlavor::Gnu),
			paths,
			&cache.references,
		)
		.await
		.unwrap();
		let common::manifest::Interpreter::LdLinux(interpreter) = manifest.interpreter.unwrap()
		else {
			panic!("expected Linux interpreter")
		};
		for (name, data) in [
			("loader", interpreter.path),
			("preload", interpreter.preloads.unwrap().remove(0)),
			("argument", interpreter.args.unwrap().remove(0)),
		] {
			let template = tg::Template::try_from_data(data).unwrap();
			let artifact = template.artifacts().next().unwrap();
			assert_eq!(artifact.id(), directory.id().into());
			assert_eq!(
				artifact.state().tokens(),
				directory.state().tokens(),
				"{name} lost authorization from {source}"
			);
			assert_eq!(artifact.state().location(), location.clone());
		}
	}
}

fn authorized_directory() -> tg::Directory {
	let directory = tg::Directory::with_entries(BTreeMap::from([(
		"lib".into(),
		tg::File::with_contents("library").into(),
	)]));
	let key = tg::authorization::PrivateKey::new(
		"test",
		tg::authorization::Algorithm::Ed25519,
		vec![0; 32],
	);
	let token = tg::authorization::Token::sign(
		tg::authorization::Body {
			expires_at: 2_000_000_000,
			permissions: vec![tg::authorization::Permission::Object(
				tg::authorization::permission::object::Permission::Subtree,
			)],
			resource: directory.id().into(),
		},
		&key,
	)
	.unwrap();
	directory
		.state()
		.set_tokens(tg::authorization::Tokens::with_local(Some(token)));
	let location = tg::Location::Remote(tg::location::Remote {
		name: "retained".into(),
		region: None,
	});
	directory.state().set_location(Some(location.clone()));
	directory
}
