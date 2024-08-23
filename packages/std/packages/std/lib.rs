use std::sync::LazyLock;
use tangram_client as tg;

pub mod manifest;
pub use manifest::Manifest;

#[cfg(feature = "tracing")]
pub mod tracing;

/// Get the host string for the current target.
#[must_use]
pub fn host() -> &'static str {
	#[cfg(all(target_arch = "aarch64", target_os = "macos"))]
	{
		"aarch64-darwin"
	}
	#[cfg(all(target_arch = "aarch64", target_os = "linux"))]
	{
		"aarch64-linux"
	}
	#[cfg(all(target_arch = "x86_64", target_os = "macos"))]
	{
		"x86_64-darwin"
	}
	#[cfg(all(target_arch = "x86_64", target_os = "linux"))]
	{
		"x86_64-linux"
	}
}

#[cfg(feature = "tracing")]
/// Convert a [`tangram_client::template::Data`] to its corresponding [`tangram_client::symlink::Data`] object.
pub fn template_data_to_symlink_data(
	template: tg::template::Data,
) -> tg::Result<tg::symlink::Data> {
	let components = template.components;
	match components.as_slice() {
		[tg::template::component::Data::String(s)] => Ok(tg::symlink::Data {
			artifact: None,
			path: Some(tg::Path::from(s)),
		}),
		[tg::template::component::Data::Artifact(id)]
		| [tg::template::component::Data::String(_), tg::template::component::Data::Artifact(id)] => {
			Ok(tg::symlink::Data {
				artifact: Some(id.clone()),
				path: None,
			})
		},
		[tg::template::component::Data::Artifact(artifact_id), tg::template::component::Data::String(s)]
		| [tg::template::component::Data::String(_), tg::template::component::Data::Artifact(artifact_id), tg::template::component::Data::String(s)] => {
			Ok(tg::symlink::Data {
				artifact: Some(artifact_id.clone()),
				path: Some(tg::Path::from(s)),
			})
		},
		_ => Err(tg::error!(
			"expected a template with 1-3 components, got {:?}",
			components
		)),
	}
}

/// Unrender a template string to a [`tangram_client::Template`] using the closest located artifact path.
pub fn unrender(string: &str) -> tg::Result<tg::Template> {
	// Get the artifacts directory path and validate the string.
	let artifacts_directory: LazyLock<String> = LazyLock::new(|| {
		let mut artifacts_directory = None;
		let cwd = std::env::current_dir().expect("Failed to get the current directory");
		for path in cwd.ancestors().skip(1) {
			let directory = path.join(".tangram/artifacts");
			if directory.exists() {
				artifacts_directory = Some(directory);
				break;
			}
		}
		artifacts_directory
			.expect("failed to find the artifacts directory")
			.to_str()
			.expect("artifacts directory should be valid UTF-8")
			.to_string()
	});

	tg::Template::unrender(&artifacts_directory, string)
}
