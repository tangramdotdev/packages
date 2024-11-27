use std::{path::PathBuf, sync::LazyLock};
use tangram_client as tg;

pub mod manifest;
pub use manifest::Manifest;

#[cfg(feature = "tracing")]
pub mod tracing;

/// Convert a [`tg::template::Data`] to its corresponding [`tg::symlink::Data`] object.
pub fn template_data_to_symlink_data(
	template: tg::template::Data,
) -> tg::Result<tg::symlink::Data> {
	let components = template.components;
	match components.as_slice() {
		[tg::template::component::Data::String(s)] => {
			Ok(tg::symlink::Data::Target { target: s.into() })
		},
		[tg::template::component::Data::Artifact(id)]
		| [tg::template::component::Data::String(_), tg::template::component::Data::Artifact(id)] => {
			Ok(tg::symlink::Data::Artifact {
				artifact: id.clone(),
				subpath: None,
			})
		},
		[tg::template::component::Data::Artifact(artifact_id), tg::template::component::Data::String(s)]
		| [tg::template::component::Data::String(_), tg::template::component::Data::Artifact(artifact_id), tg::template::component::Data::String(s)] => {
			Ok(tg::symlink::Data::Artifact {
				artifact: artifact_id.clone(),
				subpath: Some(s.chars().skip(1).collect::<String>().into()),
			})
		},
		_ => Err(tg::error!(
			"expected a template with 1-3 components, got {:?}",
			components
		)),
	}
}

/// Get a template with a single artifact component.
#[must_use]
pub fn template_from_artifact(artifact: tg::Artifact) -> tg::Template {
	tg::Template::from(tg::template::Component::from(artifact))
}

/// Compute the closest located artifact path for the current running process, reusing the result for subsequent lookups.
pub static CLOSEST_ARTIFACT_PATH: LazyLock<String> = LazyLock::new(|| {
	let mut closest_artifact_path = None;
	let cwd = std::env::current_exe()
		.expect("Failed to get the current directory")
		.canonicalize()
		.expect("failed to canonicalize current directory");
	for path in cwd.ancestors().skip(1) {
		let directory = path.join(".tangram/artifacts");
		if directory.exists() {
			closest_artifact_path = Some(
				directory
					.to_str()
					.expect("artifacts directory should be valid UTF-8")
					.to_string(),
			);
			break;
		}
	}
	closest_artifact_path.expect("Failed to find the closest artifact path")
});

/// Render a [`tg::template::Data`] to a `String` using the closest located artifact path.
pub fn render_template_data(data: &tg::template::Data) -> std::io::Result<String> {
	data.components
		.iter()
		.map(|component| match component {
			tg::template::component::Data::String(string) => Ok(string.clone()),
			tg::template::component::Data::Artifact(artifact_id) => {
				PathBuf::from(&*CLOSEST_ARTIFACT_PATH)
					.join(artifact_id.to_string())
					.into_os_string()
					.into_string()
					.map_err(|e| {
						std::io::Error::new(
							std::io::ErrorKind::InvalidData,
							format!("unable to convert OsString to String: {e:?}"),
						)
					})
			},
		})
		.collect::<std::io::Result<String>>()
}

/// Unrender a template string to a [`tg::Template`] using the closest located artifact path.
pub fn unrender(string: &str) -> tg::Result<tg::Template> {
	tg::Template::unrender(&CLOSEST_ARTIFACT_PATH, string)
}
