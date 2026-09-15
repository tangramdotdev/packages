use std::path::PathBuf;
use tangram_client::prelude::*;

mod env;
mod interpreter;
mod string;
pub use env::environment_value;
pub use interpreter::interpreter_args;
pub use string::template_from_string;

pub mod options;

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
	let artifact = tg::Artifact::with_referent(referent.clone().map(|_| id));
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

#[cfg(test)]
mod tests;
