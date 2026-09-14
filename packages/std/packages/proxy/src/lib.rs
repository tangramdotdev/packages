use std::path::PathBuf;
use tangram_client::prelude::*;

mod env;
mod flags;
pub use env::environment_value;
pub use flags::compiler_flags;

/// Interpret server-provided context; never extract artifact IDs from store paths.
pub fn artifact_path(
	referent: &tg::Referent<tg::artifact::Id>,
) -> tg::Result<(tg::Artifact, Option<PathBuf>)> {
	let (id, path) = if let Some(id) = &referent.options.id {
		let id = tg::artifact::Id::try_from(id.clone())
			.map_err(|_| tg::error!("expected an artifact root in checkin referent"))?;
		(id, referent.options.path.clone())
	} else {
		(referent.node.clone(), None)
	};
	let artifact = tg::Artifact::with_referent(tg::Referent::new(
		id,
		tg::referent::Options {
			location: referent.options.location.clone(),
			tokens: referent.options.tokens.clone(),
			..Default::default()
		},
	));
	Ok((artifact, path.filter(|path| !path.as_os_str().is_empty())))
}

/// Build a template from checkin's authorized root and optional subpath.
pub fn template_from_referent(
	referent: &tg::Referent<tg::artifact::Id>,
) -> tg::Result<tg::Template> {
	let (artifact, subpath) = artifact_path(referent)?;
	let mut template = tg::Template::builder().artifact(artifact);
	if let Some(path) = subpath {
		template = template.string(format!("/{}", path.display()));
	}
	Ok(template.build())
}

/// Only classify paths here. Checkin resolves their identity and authorization.
#[must_use]
pub fn is_store_path(path: &str) -> bool {
	[
		"/.tangram/store/",
		"/.tangram/checkouts/",
		"/opt/tangram/store/",
		"/opt/tangram/checkouts/",
	]
	.into_iter()
	.any(|prefix| path.contains(prefix))
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn checkin_template_retains_root_subpath_and_all_tokens() {
		let file = tg::File::with_contents("library");
		let root = tg::Directory::with_entries([("lib".to_owned(), file.clone().into())].into());
		let mut tokens = tg::authorization::Tokens::default();
		for resource in [file.id().into(), root.id().into()] {
			tokens.insert_local(tg::authorization::Token {
				body: tg::authorization::Body {
					expires_at: 100,
					permissions: vec![tg::authorization::Permission::Object(
						tg::authorization::permission::object::Permission::Subtree,
					)],
					resource,
				},
				metadata: tg::authorization::Metadata {
					algorithm: tg::authorization::Algorithm::Ed25519,
					key: "test".into(),
				},
				signature: vec![0; 64],
			});
		}
		let remote = tg::Location::Remote(tg::location::Remote {
			name: "test".into(),
			region: None,
		});
		tokens.insert(remote.clone(), tokens.local()[0].clone());
		let referent = tg::Referent::new(
			file.id().into(),
			tg::referent::Options {
				id: Some(root.id().into()),
				path: Some("lib".into()),
				location: Some(remote.clone()),
				tokens: tokens.clone(),
				..Default::default()
			},
		);
		let template = template_from_referent(&referent).unwrap();
		let [
			tg::template::Component::Artifact(artifact),
			tg::template::Component::String(path),
		] = template.components()
		else {
			panic!("expected a root and subpath");
		};
		assert_eq!(artifact.id(), root.id().into());
		assert_eq!(path, "/lib");
		assert_eq!(artifact.to_referent().options.tokens, tokens);
		assert_eq!(artifact.to_referent().options.location, Some(remote));
	}
}
