use std::{
	collections::BTreeMap,
	sync::{Arc, Mutex},
};
use tangram_client::prelude::*;

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
		// Static launchers preserve the wrapper path in argv[0].
		let path = std::env::args_os()
			.next()
			.map(std::path::PathBuf::from)
			.and_then(|path| {
				if path.components().count() > 1 {
					return path.is_file().then_some(path);
				}
				std::env::var_os("PATH").and_then(|paths| {
					std::env::split_paths(&paths)
						.map(|directory| directory.join(&path))
						.find(|path| path.is_file())
				})
			});
		if let Some(path) = path
			&& self.retain_from_wrapper(&path)?
		{
			return Ok(());
		}

		// Dynamic launchers also expose the wrapper through the injection library.
		let path = std::env::var_os("TANGRAM_INJECTION_IDENTITY_PATH")
			.map(std::path::PathBuf::from)
			.map_or_else(std::env::current_exe, Ok)
			.map_err(|error| tg::error!(!error, "failed to locate the linker wrapper"))?;
		self.retain_from_wrapper(&path)?;
		Ok(())
	}

	fn retain_from_wrapper(&self, path: &std::path::Path) -> tg::Result<bool> {
		// Recover the checked-out references before any rendered path needs authorization.
		let metadata = tg::file::checkout::read(path)
			.map_err(|error| tg::error!(!error, "failed to read the linker wrapper metadata"))?;
		let Some(dependencies) = metadata.dependencies else {
			return Ok(false);
		};
		let tokens = tg::authorization::Tokens::with_local(metadata.token);
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
		Ok(true)
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
		let mut artifacts = Vec::new();
		let template = common::unrender_with(string, |id| {
			let cached = self.intern(&tg::Artifact::with_id(id));
			let artifact = cached.artifact.clone();
			artifacts.push(cached);
			Ok(Some(artifact))
		})?;
		// The synchronous resolver attaches shared handles; load missing authorization before serialization.
		for cached in artifacts {
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
		}
		Ok(template)
	}
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod wrapper_tests;
