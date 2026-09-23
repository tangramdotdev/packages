use {
	super::{
		DyLdInterpreter, Executable, Interpreter, LdLinuxInterpreter, LdMuslInterpreter, Manifest,
		NormalInterpreter,
	},
	std::collections::BTreeMap,
	tangram_client::prelude::*,
};

#[test]
fn dependencies_include_every_manifest_field() {
	for manifest in manifests() {
		let dependencies = manifest.dependencies();
		let mut expected = vec![
			"executable",
			"argument",
			"environment",
			"environment template",
		];
		match &manifest.interpreter {
			Some(Interpreter::Normal(_)) => {
				expected.extend(["interpreter", "interpreter argument"]);
			},
			Some(Interpreter::LdLinux(_) | Interpreter::LdMusl(_)) => {
				expected.extend(["interpreter", "interpreter argument", "library", "preload"]);
			},
			Some(Interpreter::DyLd(_)) => expected.extend(["library", "preload"]),
			None => {},
		}
		assert_eq!(dependencies.len(), expected.len());
		for name in expected {
			let id = tg::File::with_contents(name).id();
			assert!(
				dependencies.contains_key(&tg::Reference::with_object(id.into())),
				"missing {name}"
			);
		}
	}
}

#[tokio::test]
async fn serialized_manifests_restore_dependency_handles() {
	tg::init().unwrap();
	for manifest in manifests() {
		let wrapper = tg::File::builder()
			.contents("wrapper")
			.dependencies(manifest.dependencies())
			.build()
			.unwrap();
		let bytes = serde_json::to_vec(&manifest.to_data()).unwrap();
		let mut restored =
			Manifest::try_from_data(serde_json::from_slice(&bytes).unwrap()).unwrap();
		restored.resolve_from_file(&wrapper).await.unwrap();
		assert_eq!(serde_json::to_vec(&restored.to_data()).unwrap(), bytes);
		let expected = manifest.dependencies();
		let actual = restored.dependencies();
		assert_eq!(
			actual.keys().collect::<Vec<_>>(),
			expected.keys().collect::<Vec<_>>()
		);
		for (reference, dependency) in actual {
			let file = dependency
				.unwrap()
				.0
				.node
				.unwrap()
				.try_unwrap_file()
				.unwrap();
			let original = expected[&reference]
				.as_ref()
				.unwrap()
				.0
				.node
				.as_ref()
				.unwrap()
				.clone()
				.try_unwrap_file()
				.unwrap();
			// Rebuilding must use the dependency's in-memory object, not a fresh handle from its ID.
			assert!(std::sync::Arc::ptr_eq(
				&file.object().await.unwrap(),
				&original.object().await.unwrap(),
			));
		}
	}
}

#[tokio::test]
async fn serialized_manifests_restore_missing_dependencies() {
	tg::init().unwrap();
	for manifest in manifests() {
		let expected = manifest.dependencies();
		for retained in [0, 1] {
			let dependencies = expected
				.iter()
				.take(retained)
				.map(|(key, value)| (key.clone(), value.clone()))
				.collect::<BTreeMap<_, _>>();
			let wrapper = tg::File::builder()
				.contents("wrapper without complete dependency metadata")
				.dependencies(dependencies)
				.build()
				.unwrap();
			let bytes = serde_json::to_vec(&manifest.to_data()).unwrap();
			let mut restored =
				Manifest::try_from_data(serde_json::from_slice(&bytes).unwrap()).unwrap();
			restored.resolve_from_file(&wrapper).await.unwrap();
			assert_eq!(serde_json::to_vec(&restored.to_data()).unwrap(), bytes);
			let actual = restored.dependencies();
			assert_eq!(
				actual.keys().collect::<Vec<_>>(),
				expected.keys().collect::<Vec<_>>()
			);
			for (reference, dependency) in expected.iter().take(retained) {
				let original = dependency.as_ref().unwrap().0.node.as_ref().unwrap();
				let recovered = actual[reference].as_ref().unwrap().0.node.as_ref().unwrap();
				let original = original.clone().try_unwrap_file().unwrap();
				let recovered = recovered.clone().try_unwrap_file().unwrap();
				assert!(std::sync::Arc::ptr_eq(
					&original.object().await.unwrap(),
					&recovered.object().await.unwrap(),
				));
			}
		}
	}
}

#[test]
fn serialized_manifests_omit_location() {
	for manifest in manifests() {
		let expected = serde_json::to_vec(&manifest.to_data()).unwrap();
		for dependency in manifest.dependencies().values().flatten() {
			dependency
				.0
				.node
				.as_ref()
				.unwrap()
				.state()
				.set_location(Some(tg::Location::Remote(tg::location::Remote {
					name: "test".into(),
					region: None,
				})));
		}
		assert_eq!(serde_json::to_vec(&manifest.to_data()).unwrap(), expected);
	}
}

fn template(name: &str) -> tg::Template {
	crate::template_from_artifact(tg::File::with_contents(name).into())
}

fn manifests() -> Vec<Manifest> {
	let interpreters = [
		None,
		Some(Interpreter::Normal(NormalInterpreter {
			path: template("interpreter"),
			args: vec![template("interpreter argument")],
		})),
		Some(Interpreter::LdLinux(LdLinuxInterpreter {
			path: template("interpreter"),
			args: Some(vec![template("interpreter argument")]),
			library_paths: Some(vec![template("library")]),
			preloads: Some(vec![template("preload")]),
		})),
		Some(Interpreter::LdMusl(LdMuslInterpreter {
			path: template("interpreter"),
			args: Some(vec![template("interpreter argument")]),
			library_paths: Some(vec![template("library")]),
			preloads: Some(vec![template("preload")]),
		})),
		Some(Interpreter::DyLd(DyLdInterpreter {
			library_paths: Some(vec![template("library")]),
			preloads: Some(vec![template("preload")]),
		})),
	];
	interpreters
		.into_iter()
		.map(|interpreter| {
			let argument = template("argument");
			Manifest {
				interpreter,
				executable: Executable::Path(template("executable")),
				args: Some(vec![argument.clone(), argument]),
				env: Some(tg::Mutation::Merge {
					value: BTreeMap::from([(
						"files".into(),
						tg::Value::Array(vec![
							tg::File::with_contents("environment").into(),
							template("environment template").into(),
						]),
					)]),
				}),
			}
		})
		.collect()
}
