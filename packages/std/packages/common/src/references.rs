use std::{collections::BTreeMap, sync::Mutex};
use tangram_client::prelude::*;

/// Handles retained across a rendered path boundary.
#[derive(Default)]
pub struct References {
	artifacts: Mutex<BTreeMap<tg::artifact::Id, tg::Artifact>>,
}

impl References {
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
		if let Some(path) = path {
			self.retain_from_wrapper(&path)?;
		}

		// Dynamic launchers also expose the wrapper through the injection library.
		let path = std::env::var_os("TANGRAM_INJECTION_IDENTITY_PATH")
			.map(std::path::PathBuf::from)
			.map_or_else(std::env::current_exe, Ok)
			.map_err(|error| tg::error!(!error, "failed to locate the launching wrapper"))?;
		self.retain_from_wrapper(&path)?;
		Ok(())
	}

	fn retain_from_wrapper(&self, path: &std::path::Path) -> tg::Result<()> {
		// Recover the checked-out references before any rendered path needs authorization.
		let metadata = tg::file::checkout::read(path)
			.map_err(|error| tg::error!(!error, "failed to read the launching wrapper metadata"))?;
		let Some(dependencies) = metadata.dependencies else {
			return Ok(());
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
			artifact.state().inherit_tokens(&options.tokens);
			artifact.state().inherit_tokens(&tokens);
			self.retain(&artifact);
		}
		Ok(())
	}

	/// Retain the typed handles in a value before crossing a rendered path boundary.
	pub fn retain_value(&self, value: &tg::Value) {
		for object in value.objects() {
			if let Ok(artifact) = tg::Artifact::try_from(object) {
				self.retain(&artifact);
			}
		}
	}

	pub fn retain(&self, artifact: &tg::Artifact) -> tg::Artifact {
		let mut artifacts = self.artifacts.lock().unwrap();
		let retained = artifacts
			.entry(artifact.id())
			.or_insert_with(|| artifact.clone());
		retained
			.state()
			.inherit_location(artifact.state().location().as_ref());
		retained.state().inherit_tokens(&artifact.state().tokens());
		if retained.state().object().is_none()
			&& let Some(object) = artifact.state().object()
		{
			retained.state().set_object(object);
		}
		if !artifact.state().stored() {
			retained.state().set_stored(false);
		}
		retained.clone()
	}

	pub async fn unrender(&self, string: &str) -> tg::Result<tg::Template> {
		let template = crate::unrender_with(string, |id| {
			Ok(Some(self.retain(&tg::Artifact::with_id(id))))
		})?;
		for artifact in template.artifacts() {
			if artifact.state().tokens().is_empty() && artifact.state().stored() {
				artifact.load().await.map_err(
					|error| tg::error!(!error, artifact = %artifact.id(), "failed to load an unrendered artifact"),
				)?;
			}
		}
		Ok(template)
	}
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod wrapper_tests;
