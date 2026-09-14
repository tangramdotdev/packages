use std::path::PathBuf;
use tangram_client::prelude::*;

pub mod paths;
pub use paths::{artifact_path, checkin_path, is_store_path, template_from_path};

pub mod manifest;
pub use manifest::Manifest;

#[cfg(feature = "tracing")]
pub mod tracing;

pub mod error;

/// Interpret a [`tg::Template`] as its corresponding [`tg::Symlink`].
pub fn template_to_symlink(template: &tg::Template) -> tg::Result<tg::Symlink> {
	use tg::template::Component;
	match template.components() {
		[Component::String(s)] => Ok(tg::Symlink::with_path(s.into())),
		[Component::Artifact(artifact)] | [Component::String(_), Component::Artifact(artifact)] => {
			Ok(tg::Symlink::with_artifact(artifact.clone()))
		},
		[Component::Artifact(artifact), Component::String(s)]
		| [
			Component::String(_),
			Component::Artifact(artifact),
			Component::String(s),
		] => Ok(tg::Symlink::with_artifact_and_path(
			artifact.clone(),
			s.chars().skip(1).collect::<String>().into(),
		)),
		components => Err(tg::error!(
			"expected a template with 1-3 components, got {components:?}"
		)),
	}
}

/// Get a template with a single artifact component.
#[must_use]
pub fn template_from_artifact(artifact: tg::Artifact) -> tg::Template {
	tg::Template::from(tg::template::Component::from(artifact))
}

/// Get a template with a single artifact component and single subpath.
#[must_use]
pub fn template_from_artifact_and_subpath(
	artifact: tg::Artifact,
	subpath: impl AsRef<std::path::Path>,
) -> tg::Template {
	let subpath = subpath.as_ref().display().to_string();
	tg::Template::from(vec![
		tg::template::Component::from(artifact),
		tg::template::Component::from(format!("/{subpath}")),
	])
}

/// Check out the given artifacts into the store, returning their paths.
pub async fn checkout_artifacts(artifacts: Vec<tg::Artifact>) -> tg::Result<Vec<PathBuf>> {
	let nodes = artifacts
		.into_iter()
		.map(|artifact| artifact.to_referent().map(Into::into))
		.collect();
	tg::checkout(tg::checkout::Arg {
		dependencies: true,
		extension: None,
		force: false,
		lock: None,
		nodes,
		path: None,
	})
	.await
}

/// Check out a single artifact into the store, returning its path.
pub async fn checkout_artifact(artifact: tg::Artifact) -> tg::Result<PathBuf> {
	let mut paths = checkout_artifacts(vec![artifact]).await?;
	if paths.len() != 1 {
		return Err(tg::error!("expected exactly one checkout path"));
	}
	Ok(paths.pop().unwrap())
}

/// Check out a single artifact to the given path, overwriting whatever is already there.
pub async fn checkout_artifact_to_path(artifact: tg::Artifact, path: PathBuf) -> tg::Result<()> {
	tg::checkout(tg::checkout::Arg {
		dependencies: false,
		extension: None,
		force: true,
		lock: Some(tg::checkout::Lock::Attr),
		nodes: vec![artifact.to_referent().map(Into::into)],
		path: Some(path),
	})
	.await?;
	Ok(())
}

/// Render a template by checking out its authorized artifact handles.
pub async fn render_template_data(data: &tg::template::Data) -> tg::Result<String> {
	tg::Template::try_from_data(data.clone())?
		.try_render(|component| async move {
			match component {
				tg::template::Component::String(string) => Ok(string.clone()),
				tg::template::Component::Artifact(artifact) => checkout_artifact(artifact.clone())
					.await?
					.into_os_string()
					.into_string()
					.map_err(|_| tg::error!("checkout path is not UTF-8")),
				tg::template::Component::Placeholder(_) => {
					Err(tg::error!("cannot render an unresolved placeholder"))
				},
			}
		})
		.await
}
