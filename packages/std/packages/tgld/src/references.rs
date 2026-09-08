use std::{
	collections::BTreeMap,
	sync::{Arc, Mutex},
};
use tangram_client::prelude::*;
use xattr::FileExt as _;

/// Handles retained across the linker's rendered path boundary.
#[derive(Default)]
pub struct ArtifactReferences {
	artifacts: Mutex<BTreeMap<tg::artifact::Id, CachedArtifact>>,
}

#[derive(Clone)]
struct CachedArtifact {
	artifact: tg::Artifact,
	loaded: Arc<futures::lock::Mutex<bool>>,
}

impl ArtifactReferences {
	pub fn retain_from_current_executable(&self) -> tg::Result<()> {
		// The wrapper sets this on Linux too, where current_exe can name the loader.
		let path = std::env::var_os("TANGRAM_INJECTION_IDENTITY_PATH")
			.map(std::path::PathBuf::from)
			.map_or_else(std::env::current_exe, Ok)
			.map_err(|error| tg::error!(!error, "failed to locate the linker wrapper"))?;
		self.retain_from_wrapper(&path)
	}

	fn retain_from_wrapper(&self, path: &std::path::Path) -> tg::Result<()> {
		// Read the checked-out dependency referents, rather than loading their bare IDs.
		let file = std::fs::File::open(path).map_err(
			|error| tg::error!(!error, path = %path.display(), "failed to open the linker wrapper"),
		)?;
		let dependencies = wrapper_dependencies(&file)?;
		if dependencies.is_empty() {
			return Ok(());
		}
		let token = file
			.get_xattr(tg::file::TOKEN_XATTR_NAME)
			.map_err(|error| tg::error!(!error, "failed to read the wrapper token"))?
			.map(|value| {
				std::str::from_utf8(&value)
					.map_err(|error| tg::error!(!error, "invalid wrapper token encoding"))?
					.parse::<tg::authorization::Token>()
			})
			.transpose()?;
		let tokens = tg::authorization::Tokens::with_local(token);
		for reference in dependencies {
			let tg::reference::Node::Id(id) = reference.node() else {
				continue;
			};
			let Ok(id) = tg::artifact::Id::try_from(id.clone()) else {
				continue;
			};
			let options = reference.options();
			let artifact = tg::Artifact::with_id(id);
			artifact.state().set_location(
				options
					.location
					.as_ref()
					.and_then(tg::location::Arg::to_location),
			);
			artifact.state().set_tokens(common::merge_tokens(
				&artifact.id().into(),
				&options.tokens,
				&tokens,
			));
			self.retain(&artifact);
		}
		Ok(())
	}

	pub fn with_options(options: &super::Options) -> Self {
		let references = Self::default();
		let mut dependencies = BTreeMap::new();
		for template in options.wrapper_arg_value.iter().flatten() {
			common::manifest::collect_dependencies_from_template_data(template, &mut dependencies);
		}
		if let Some(env) = &options.wrapper_env_value {
			common::manifest::collect_dependencies_from_mutation_data(env, &mut dependencies);
		}
		for dependency in dependencies.into_values().flatten() {
			if let Some(object) = dependency.0.node
				&& let Ok(artifact) = tg::Artifact::try_from(object)
			{
				references.retain(&artifact);
			}
		}
		references
	}

	pub fn retain(&self, artifact: &tg::Artifact) -> tg::Artifact {
		self.intern(artifact).artifact
	}

	fn intern(&self, artifact: &tg::Artifact) -> CachedArtifact {
		let mut artifacts = self.artifacts.lock().unwrap();
		let cached = artifacts
			.entry(artifact.id())
			.or_insert_with(|| CachedArtifact {
				artifact: artifact.clone(),
				loaded: Arc::default(),
			});
		let retained = &cached.artifact;
		retained
			.state()
			.inherit_location(artifact.state().location().as_ref());
		retained.state().set_tokens(common::merge_tokens(
			&retained.id().into(),
			&retained.state().tokens(),
			&artifact.state().tokens(),
		));
		if retained.state().object().is_none()
			&& let Some(object) = artifact.state().object()
		{
			retained.state().set_object(object);
		}
		if !artifact.state().stored() {
			retained.state().set_stored(false);
		}
		cached.clone()
	}

	pub async fn unrender(&self, string: &str) -> tg::Result<tg::Template> {
		self.unrender_with(string, |artifact| async move {
			artifact.load().await?;
			Ok(())
		})
		.await
	}

	async fn unrender_with<F, Fut>(&self, string: &str, load: F) -> tg::Result<tg::Template>
	where
		F: Fn(tg::Artifact) -> Fut,
		Fut: Future<Output = tg::Result<()>>,
	{
		let mut template = common::unrender(string)?;
		for component in &mut template.components {
			let tg::template::Component::Artifact(artifact) = component else {
				continue;
			};
			let cached = self.intern(artifact);
			let mut loaded = cached.loaded.lock().await;
			if !*loaded
				&& cached.artifact.state().tokens().is_empty()
				&& cached.artifact.state().stored()
			{
				// Load separately: the client replaces tokens on load, whereas another caller may
				// retain a newer or broader grant while this request is in flight.
				let pending = tg::Artifact::with_referent(cached.artifact.to_referent());
				load(pending.clone()).await.map_err(
					|error| tg::error!(!error, artifact = %pending.id(), "failed to load an unrendered artifact"),
				)?;
				self.retain(&pending);
				*loaded = true;
			}
			*artifact = cached.artifact;
		}
		Ok(template)
	}
}

fn wrapper_dependencies(file: &std::fs::File) -> tg::Result<Vec<tg::Reference>> {
	let names = match file.list_xattr() {
		Ok(names) => names,
		Err(error) if error.kind() == std::io::ErrorKind::Unsupported => return Ok(Vec::new()),
		Err(error) => return Err(tg::error!(!error, "failed to list wrapper attributes")),
	};
	let mut base = false;
	let mut shards = BTreeMap::new();
	for name in names {
		let Some(name) = name.to_str() else { continue };
		if name == tg::file::DEPENDENCIES_XATTR_NAME {
			base = true;
		} else if let Some(suffix) = name
			.strip_prefix(tg::file::DEPENDENCIES_XATTR_NAME)
			.and_then(|name| name.strip_prefix('.'))
		{
			let index = suffix
				.parse::<usize>()
				.map_err(|error| tg::error!(!error, "invalid wrapper dependency shard"))?;
			if suffix != index.to_string() {
				return Err(tg::error!("invalid wrapper dependency shard"));
			}
			shards.insert(index, name.to_owned());
		}
	}
	if base {
		if !shards.is_empty() {
			return Err(tg::error!("mixed wrapper dependency attributes"));
		}
		shards.insert(0, tg::file::DEPENDENCIES_XATTR_NAME.to_owned());
	}
	if shards.is_empty() {
		return Ok(Vec::new());
	}
	let mut bytes = Vec::new();
	for (expected, (index, name)) in shards.into_iter().enumerate() {
		if index != expected {
			return Err(tg::error!("missing wrapper dependency shard"));
		}
		let value = file
			.get_xattr(name)
			.map_err(|error| tg::error!(!error, "failed to read wrapper dependencies"))?
			.ok_or_else(|| tg::error!("wrapper dependencies disappeared"))?;
		bytes.extend_from_slice(&value);
	}
	tg::file::deserialize_dependencies_xattr(&bytes)
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod wrapper_tests;
