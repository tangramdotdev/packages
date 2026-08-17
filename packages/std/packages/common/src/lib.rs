use std::{
	path::PathBuf,
	sync::{LazyLock, Mutex},
};
use tangram_client::prelude::*;

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

struct StoreRootSearch {
	/// Roots discovered so far, ordered closest-first.
	found: Vec<String>,
	/// Candidates not yet probed.
	pending: std::vec::IntoIter<PathBuf>,
}

static STORE_ROOTS: LazyLock<Mutex<StoreRootSearch>> = LazyLock::new(|| {
	let exe = std::env::current_exe()
		.expect("failed to get the current executable")
		.canonicalize()
		.expect("failed to canonicalize the current executable");
	let mut pending: Vec<PathBuf> = exe
		.ancestors()
		.skip(1)
		.map(|a| a.join(".tangram/store"))
		.collect();
	pending.push(PathBuf::from("/opt/tangram/store"));
	Mutex::new(StoreRootSearch {
		found: Vec::new(),
		pending: pending.into_iter(),
	})
});

/// Return the i-th store root, walking ancestors only as far as needed.
fn store_root_at(index: usize) -> Option<String> {
	let mut search = STORE_ROOTS.lock().unwrap();
	while search.found.len() <= index {
		let candidate = search.pending.next()?;
		if candidate.is_dir() {
			let s = candidate
				.to_str()
				.expect("store root path must be valid UTF-8")
				.to_string();
			search.found.push(s);
		}
	}
	search.found.get(index).cloned()
}

/// Check out the given artifacts into the store, returning their paths.
pub async fn checkout_artifacts(
	artifacts: Vec<tg::Referent<tg::artifact::Id>>,
) -> tg::Result<Vec<PathBuf>> {
	let nodes = artifacts
		.into_iter()
		.map(|referent| referent.map(|id| tg::Selector::Id(id.into())))
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
pub async fn checkout_artifact(artifact: tg::artifact::Id) -> tg::Result<PathBuf> {
	let mut paths = checkout_artifacts(vec![tg::Referent::with_node(artifact)]).await?;
	if paths.len() != 1 {
		return Err(tg::error!("expected exactly one checkout path"));
	}
	Ok(paths.pop().unwrap())
}

/// Check out a single artifact to the given path, overwriting whatever is already there.
pub async fn checkout_artifact_to_path(
	artifact: tg::artifact::Id,
	path: PathBuf,
) -> tg::Result<()> {
	tg::checkout(tg::checkout::Arg {
		dependencies: false,
		extension: None,
		force: true,
		lock: Some(tg::checkout::Lock::Attr),
		nodes: vec![tg::Referent::with_node(tg::Selector::Id(artifact.into()))],
		path: Some(path),
	})
	.await?;
	Ok(())
}

/// Substring check: does this path live under any store root?
#[must_use]
pub fn is_store_path(path: &str) -> bool {
	path.contains("/.tangram/store/") || path.contains("/opt/tangram/store/")
}

/// Find the on-disk path for an artifact ID by walking ancestor roots.
#[must_use]
pub fn store_path_for(id: &tg::artifact::Id) -> Option<PathBuf> {
	let suffix = id.to_string();
	let mut i = 0;
	while let Some(root) = store_root_at(i) {
		let candidate = PathBuf::from(&root).join(&suffix);
		if candidate.exists() {
			return Some(candidate);
		}
		i += 1;
	}
	None
}

/// Render a [`tg::template::Data`] to a `String`, using the closest artifact that contains it.
pub fn render_template_data(data: &tg::template::Data) -> tg::Result<String> {
	data.components
		.iter()
		.map(|component| match component {
			tg::template::data::Component::String(string) => Ok(string.clone()),
			tg::template::data::Component::Artifact(artifact_id) => {
				let artifact_id = &artifact_id.node;
				let path = store_path_for(artifact_id).ok_or_else(|| {
					tg::error!("artifact {artifact_id} not present in any store root")
				})?;
				path.into_os_string()
					.into_string()
					.map_err(|os| tg::error!("artifact path is not valid UTF-8: {}", os.display()))
			},
			tg::template::data::Component::Placeholder(data) => Ok(data.name.clone()),
		})
		.collect()
}

/// Unrender a template string into a [`tg::Template`].
pub fn unrender(string: &str) -> tg::Result<tg::Template> {
	let mut i = 0;
	while let Some(root) = store_root_at(i) {
		if string.contains(&format!("{root}/")) {
			return tg::Template::unrender(&root, string);
		}
		i += 1;
	}
	if string.contains("/opt/tangram/store/") {
		return tg::Template::unrender("/opt/tangram/store", string);
	}
	Ok(tg::Template::from(tg::template::Component::String(
		string.to_owned(),
	)))
}
