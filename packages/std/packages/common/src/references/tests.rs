use super::*;

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
	let references = References::default();
	let file = authorized_file();
	let location = tg::Location::Remote(tg::location::Remote {
		name: "retained".into(),
		region: None,
	});
	file.state().set_location(Some(location.clone()));
	references.retain(&file.clone().into());
	let path = format!("--preload=/opt/tangram/store/{}", file.id());
	let template = references.unrender(&path).await.unwrap();
	let artifact = template.artifacts().next().unwrap();
	assert_eq!(artifact.state().tokens(), file.state().tokens());
	assert_eq!(artifact.state().location(), Some(location));
	// Changes remain visible through the canonical handle, not a reconstructed copy.
	file.state().set_location(None);
	assert_eq!(artifact.state().location(), None);
}

#[tokio::test]
async fn unrender_plain_paths_do_not_load_objects() {
	let references = References::default();
	let template = references.unrender("--argument=/usr/lib").await.unwrap();
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
	let references = References::default();
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
