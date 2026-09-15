use std::path::{Path, PathBuf};
use tangram_client::prelude::*;

pub use proxy::{artifact_path, interpreter_args};

pub mod manifest;
pub use manifest::Manifest;

#[cfg(feature = "tracing")]
pub mod tracing;

pub mod error;

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
	for artifact in &artifacts {
		artifact.store().await?;
	}
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
	artifact.store().await?;
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

/// Check in a path with its authorization and containing root/subpath context.
/// Keep the output referent until its context has been consumed; artifact handles retain only tokens and location.
pub async fn checkin_path(path: impl AsRef<Path>) -> tg::Result<tg::checkin::Output> {
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

pub async fn template_from_path(path: impl AsRef<Path>) -> tg::Result<tg::Template> {
	let output = checkin_path(path).await?;
	proxy::template_from_referent(&output.artifact)
}
