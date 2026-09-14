//! Package-local checkin and path handling. This code is intentionally duplicated
//! from std's common crate so tgrustc can be built from its own source bundle.

use std::path::{Path, PathBuf};
use tangram_client::prelude::*;

/// Check in a path with its authorization and containing root/subpath context.
/// Requires the incoming client contract: `Artifact::to_referent` preserves checkin context.
pub async fn checkin_path(path: impl AsRef<Path>) -> tg::Result<tg::Artifact> {
	tg::checkin(tg::checkin::Arg {
		options: tg::checkin::Options {
			destructive: false,
			deterministic: true,
			ignore: false,
			lock: None,
			locked: true,
			root: true,
			..Default::default()
		},
		path: std::path::absolute(path)
			.map_err(|error| tg::error!(!error, "invalid checkin path"))?,
		updates: Vec::new(),
	})
	.await
}

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

pub async fn template_from_path(path: impl AsRef<Path>) -> tg::Result<tg::Template> {
	let artifact = checkin_path(path).await?;
	let (artifact, subpath) = artifact_path(&artifact.to_referent())?;
	let mut components = vec![tg::template::Component::Artifact(artifact)];
	if let Some(subpath) = subpath {
		components.push(tg::template::Component::String(format!(
			"/{}",
			subpath.display()
		)));
	}
	Ok(tg::Template::with_components(components))
}

/// Only classify paths here. Checkin resolves their identity and authorization.
#[must_use]
pub fn is_store_path(path: &str) -> bool {
	path.contains("/.tangram/store/") || path.contains("/opt/tangram/store/")
}

pub async fn render_template(template: &tg::Template) -> tg::Result<String> {
	template
		.try_render(|component| async move {
			match component {
				tg::template::Component::String(string) => Ok(string.clone()),
				tg::template::Component::Artifact(artifact) => {
					let mut paths = tg::checkout(tg::checkout::Arg {
						dependencies: true,
						extension: None,
						force: false,
						lock: None,
						nodes: vec![artifact.to_referent().map(Into::into)],
						path: None,
					})
					.await?;
					if paths.len() != 1 {
						return Err(tg::error!("expected one checkout path"));
					}
					paths
						.pop()
						.unwrap()
						.into_os_string()
						.into_string()
						.map_err(|_| tg::error!("checkout path is not UTF-8"))
				},
				tg::template::Component::Placeholder(_) => {
					Err(tg::error!("cannot render an unresolved placeholder"))
				},
			}
		})
		.await
}

/// Respect shell overrides of shadow values, retaining structured values when they still match.
pub async fn env_value(name: &str, raw: &str, typed: Option<&tg::Value>) -> tg::Result<tg::Value> {
	let template = match typed {
		Some(tg::Value::Template(template)) => Some(template.clone()),
		Some(tg::Value::Object(object)) => {
			tg::Artifact::try_from(object.clone()).ok().map(|artifact| {
				tg::Template::with_components([tg::template::Component::Artifact(artifact)])
			})
		},
		_ => None,
	};
	if let Some(template) = template
		&& let Some(template) = checkin_rendered_template(&template, raw).await?
	{
		return Ok(tg::Value::Template(template));
	}
	if !is_store_path(raw) {
		return Ok(tg::Value::String(raw.to_owned()));
	}
	let separator = match name {
		"PATH"
		| "LD_LIBRARY_PATH"
		| "DYLD_LIBRARY_PATH"
		| "DYLD_FALLBACK_LIBRARY_PATH"
		| "DYLD_INSERT_LIBRARIES"
		| "LIBRARY_PATH"
		| "CPATH"
		| "C_INCLUDE_PATH"
		| "CPLUS_INCLUDE_PATH"
		| "OBJC_INCLUDE_PATH"
		| "PKG_CONFIG_PATH"
		| "PKG_CONFIG_LIBDIR" => Some(':'),
		"CMAKE_PREFIX_PATH" => Some(';'),
		_ => None,
	};
	let paths = separator.map_or_else(|| vec![raw], |separator| raw.split(separator).collect());
	let mut components = Vec::new();
	for (index, path) in paths.into_iter().enumerate() {
		if index > 0 {
			components.push(tg::template::Component::String(
				separator.unwrap().to_string(),
			));
		}
		if is_store_path(path) {
			if !Path::new(path).is_absolute() || path.contains(['\n', '\r', '\'', '"']) {
				return Err(tg::error!(
					variable = name,
					"unsupported embedded store path; pass a structured template"
				));
			}
			let template = template_from_path(path).await.map_err(|error| {
				tg::error!(
					!error,
					variable = name,
					"failed to check in environment path; use a structured template for embedded paths"
				)
			})?;
			components.extend(template.components);
		} else {
			components.push(tg::template::Component::String(path.to_owned()));
		}
	}
	Ok(tg::Value::Template(tg::Template::with_components(
		components,
	)))
}

/// Use an existing template's literal boundaries to locate its rendered artifact paths.
/// Compare checked-in identities to detect stale shadow values. IDs are never parsed from paths.
async fn checkin_rendered_template(
	template: &tg::Template,
	mut raw: &str,
) -> tg::Result<Option<tg::Template>> {
	let mut components = Vec::new();
	for (index, component) in template.components().iter().enumerate() {
		match component {
			tg::template::Component::String(string) => {
				let Some(rest) = raw.strip_prefix(string) else {
					return Ok(None);
				};
				raw = rest;
				components.push(component.clone());
			},
			tg::template::Component::Artifact(expected) => {
				let end = match template.components().get(index + 1) {
					Some(tg::template::Component::String(suffix)) if !suffix.is_empty() => {
						let end = if index + 2 == template.components().len() {
							raw.strip_suffix(suffix).map(str::len)
						} else {
							raw.find(suffix)
						};
						let Some(end) = end else {
							return Ok(None);
						};
						end
					},
					None => raw.len(),
					_ => return Ok(None),
				};
				let path = &raw[..end];
				if !Path::new(path).is_absolute() {
					return Ok(None);
				}
				let Ok(artifact) = checkin_path(path).await else {
					return Ok(None);
				};
				if artifact.id() != expected.id() {
					return Ok(None);
				}
				components.push(tg::template::Component::Artifact(artifact));
				raw = &raw[end..];
			},
			tg::template::Component::Placeholder(_) => return Ok(None),
		}
	}
	Ok(raw
		.is_empty()
		.then(|| tg::Template::with_components(components)))
}

#[cfg(test)]
mod tests {
	use super::*;

	fn referent() -> tg::Referent<tg::artifact::Id> {
		let node = "fil_010000000000000000000000000000000000000000000000000000"
			.parse()
			.unwrap();
		let root: tg::artifact::Id = "dir_010000000000000000000000000000000000000000000000000000"
			.parse()
			.unwrap();
		let token = tg::authorization::Token {
			body: tg::authorization::Body {
				expires_at: i64::MAX,
				permissions: vec![tg::authorization::Permission::Object(
					tg::authorization::permission::object::Permission::Subtree,
				)],
				resource: root.clone().into(),
			},
			metadata: tg::authorization::Metadata {
				algorithm: tg::authorization::Algorithm::Ed25519,
				key: "test".into(),
			},
			signature: vec![0; 64],
		};
		let location = tg::Location::Remote(tg::location::Remote {
			name: "test".into(),
			region: None,
		});
		let mut tokens = tg::authorization::Tokens::with_local([token.clone()]);
		tokens.insert(location.clone(), token);
		tg::Referent::new(
			node,
			tg::referent::Options {
				id: Some(root.into()),
				path: Some("lib/libexample.so.1".into()),
				location: Some(location),
				tokens,
				..Default::default()
			},
		)
	}

	#[test]
	fn root_path_keeps_name_location_and_both_token_locations() {
		let referent = referent();
		let (root, path) = artifact_path(&referent).unwrap();
		assert_eq!(
			tg::object::Id::from(root.id()),
			referent.options.id.clone().unwrap()
		);
		assert_eq!(path.as_deref(), Some(Path::new("lib/libexample.so.1")));
		assert_eq!(
			root.to_referent().options.location,
			referent.options.location
		);
		assert_eq!(root.to_referent().options.tokens, referent.options.tokens);
		// The selected root is now a standalone artifact, so context is not applied twice.
		assert!(root.to_referent().options.id.is_none());
		assert!(root.to_referent().options.path.is_none());
	}

	#[test]
	fn missing_root_uses_resolved_node_without_a_subpath() {
		let mut referent = referent();
		referent.options.id = None;
		let (artifact, path) = artifact_path(&referent).unwrap();
		assert_eq!(artifact.id(), referent.node);
		assert_eq!(
			artifact.to_referent().options.tokens,
			referent.options.tokens
		);
		assert!(path.is_none());
	}

	#[test]
	fn empty_root_subpath_does_not_append_a_slash() {
		let mut referent = referent();
		referent.options.path = Some(PathBuf::new());
		assert!(artifact_path(&referent).unwrap().1.is_none());
	}

	#[test]
	fn unsupported_embedded_environment_path_fails() {
		let runtime = tokio::runtime::Builder::new_current_thread()
			.build()
			.unwrap();
		let result = runtime.block_on(env_value(
			"CFLAGS",
			"-I/opt/tangram/store/example/include",
			None,
		));
		assert!(
			result
				.unwrap_err()
				.to_string()
				.contains("structured template")
		);
	}
}
