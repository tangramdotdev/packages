use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};

pub(super) fn authorized_file() -> tg::File {
	let file = tg::File::with_contents("unrendered dependency");
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
			resource: file.id().into(),
		},
		&key,
	)
	.unwrap();
	file.state()
		.set_tokens(tg::authorization::Tokens::with_local(Some(token)));
	file
}

#[tokio::test]
async fn unrender_reuses_authorized_handle_without_loading() {
	let references = ArtifactReferences::default();
	let file = authorized_file();
	let location = tg::Location::Remote(tg::location::Remote {
		name: "retained".into(),
		region: None,
	});
	file.state().set_location(Some(location.clone()));
	references.retain(&file.clone().into());
	let path = format!("--preload=/opt/tangram/store/{}", file.id());
	let template = references
		.unrender_with(&path, |_| async {
			panic!("an authorized retained handle must not trigger an object lookup")
		})
		.await
		.unwrap();
	let artifact = template.artifacts().next().unwrap();
	assert_eq!(artifact.state().tokens(), file.state().tokens());
	assert_eq!(artifact.state().location(), Some(location));
	// Changes remain visible through the canonical handle, not a reconstructed copy.
	file.state().set_location(None);
	assert_eq!(artifact.state().location(), None);
}

#[tokio::test]
async fn unrender_loads_each_unknown_id_once_and_retains_its_token() {
	let references = ArtifactReferences::default();
	let file = authorized_file();
	let path = format!(
		"/opt/tangram/store/{}:/opt/tangram/store/{}",
		file.id(),
		file.id()
	);
	let requests = AtomicUsize::new(0);
	let load = |artifact: tg::Artifact| {
		let file = &file;
		let requests = &requests;
		async move {
			requests.fetch_add(1, Ordering::SeqCst);
			// Overlap callers to exercise coalescing of cold lookups.
			tokio::task::yield_now().await;
			artifact.state().set_object(file.state().object().unwrap());
			artifact.state().set_tokens(file.state().tokens());
			Ok(())
		}
	};
	let templates =
		futures::future::try_join_all((0..8).map(|_| references.unrender_with(&path, &load)))
			.await
			.unwrap();
	assert_eq!(
		requests.load(Ordering::SeqCst),
		1,
		"one authorization search per unique ID"
	);
	for template in templates {
		for artifact in template.artifacts() {
			assert_eq!(artifact.state().tokens(), file.state().tokens());
		}
		let mut dependencies = BTreeMap::new();
		common::manifest::collect_dependencies_from_template_data(
			&template.to_data(),
			&mut dependencies,
		);
		assert_eq!(dependencies.len(), 1);
		let dependency = dependencies
			.values()
			.flatten()
			.next()
			.unwrap()
			.0
			.node
			.as_ref()
			.unwrap();
		assert_eq!(dependency.state().tokens(), file.state().tokens());
	}
	references.unrender_with(&path, &load).await.unwrap();
	assert_eq!(requests.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn unrender_propagates_load_failure_and_can_retry() {
	let references = ArtifactReferences::default();
	let file = authorized_file();
	let path = format!("/opt/tangram/store/{}", file.id());
	let result = references
		.unrender_with(&path, |_| async { Err(tg::error!("lookup failed")) })
		.await;
	assert!(
		result.is_err(),
		"do not silently emit an unauthorized manifest reference"
	);
	let template = references
		.unrender_with(&path, |artifact| {
			let file = &file;
			async move {
				artifact.state().set_tokens(file.state().tokens());
				Ok(())
			}
		})
		.await
		.unwrap();
	assert_eq!(
		template.artifacts().next().unwrap().state().tokens(),
		file.state().tokens()
	);
}

#[tokio::test]
async fn unrender_preserves_grants_retained_during_load() {
	let references = ArtifactReferences::default();
	let file = authorized_file();
	let location = tg::Location::Remote(tg::location::Remote {
		name: "other".into(),
		region: None,
	});
	let mut tokens = file.state().tokens();
	tokens.set(location, tokens.local().unwrap().clone());
	file.state().set_tokens(tokens.clone());
	let path = format!("/opt/tangram/store/{}", file.id());
	let template = references
		.unrender_with(&path, |pending| {
			let references = &references;
			let file = &file;
			async move {
				// Another traversal finds an authorized handle while the fallback request is pending.
				references.retain(&file.clone().into());
				let key = tg::authorization::PrivateKey::new(
					"test",
					tg::authorization::Algorithm::Ed25519,
					vec![0; 32],
				);
				let token = tg::authorization::Token::sign(
					tg::authorization::Body {
						expires_at: 2_000_000_100,
						permissions: vec![tg::authorization::Permission::Object(
							tg::authorization::permission::object::Permission::Node,
						)],
						resource: file.id().into(),
					},
					&key,
				)
				.unwrap();
				pending
					.state()
					.set_tokens(tg::authorization::Tokens::with_local(Some(token)));
				Ok(())
			}
		})
		.await
		.unwrap();
	assert_eq!(
		template.artifacts().next().unwrap().state().tokens(),
		tokens,
		"a load response must not discard another location or downgrade subtree access"
	);
}

#[tokio::test]
async fn unrender_plain_paths_do_not_load_objects() {
	let references = ArtifactReferences::default();
	let template = references
		.unrender_with("--argument=/usr/lib", |_| async {
			panic!("a plain path must not cause an object lookup")
		})
		.await
		.unwrap();
	assert!(
		matches!(template.components(), [tg::template::Component::String(value)] if value == "--argument=/usr/lib")
	);
}

#[tokio::test]
#[ignore = "requires a running Tangram server"]
async fn unrender_loads_authorization_from_server() {
	tg::init().unwrap();
	let file = tg::File::with_contents("server-backed unrender regression");
	file.store().await.unwrap();
	let references = ArtifactReferences::default();
	let path = format!("/opt/tangram/store/{}", file.id());
	let template = references.unrender(&path).await.unwrap();
	let artifact = template.artifacts().next().unwrap();
	assert!(
		!artifact.state().tokens().is_empty(),
		"load must acquire authorization before to_data"
	);
	assert!(
		artifact.state().object().is_some(),
		"retain the loaded object for subsequent reads"
	);
	let restored = tg::Template::try_from_data(template.to_data()).unwrap();
	assert_eq!(
		restored.artifacts().next().unwrap().state().tokens(),
		artifact.state().tokens()
	);
	assert_eq!(
		restored
			.artifacts()
			.next()
			.unwrap()
			.clone()
			.try_unwrap_file()
			.unwrap()
			.text()
			.await
			.unwrap(),
		"server-backed unrender regression"
	);
}
