use {
	std::{
		path::{Path, PathBuf},
		sync::LazyLock,
	},
	tangram_client::prelude::*,
};

#[cfg(test)]
mod tests;

static ARTIFACT_REFERENCE_PATTERN: LazyLock<tg::Result<regex::Regex>> = LazyLock::new(|| {
	let executable = std::env::current_exe()
		.and_then(|path| path.canonicalize())
		.map_err(|error| tg::error!(!error, "failed to locate the current executable"))?;
	artifact_reference_pattern(&executable)
});

/// Recover embedded Tangram references without interpreting the surrounding text.
/// Checkin supplies identity, context, and authorization for each occurrence.
pub async fn template_from_string(
	raw: &str,
	mut template_from_path: impl AsyncFnMut(&str) -> tg::Result<tg::Template>,
) -> tg::Result<tg::Template> {
	let pattern = ARTIFACT_REFERENCE_PATTERN.as_ref().map_err(Clone::clone)?;
	let mut template = tg::Template::builder();
	let mut end = 0;
	for path in pattern.find_iter(raw) {
		template = template
			.string(&raw[end..path.start()])
			.components(template_from_path(path.as_str()).await?.components);
		end = path.end();
	}
	Ok(template.string(&raw[end..]).build())
}

fn artifact_reference_pattern(executable: &Path) -> tg::Result<regex::Regex> {
	// Recognize the installation that contains an internal checkout of the proxy.
	let installations = executable
		.ancestors()
		.skip(1)
		.filter(|path| {
			path.file_name()
				.is_some_and(|name| name == "store" || name == "checkouts")
		})
		.filter_map(Path::parent)
		.map(Path::to_path_buf);
	let roots = executable
		.ancestors()
		.skip(1)
		.map(|path| path.join(".tangram"))
		.chain(installations)
		.chain([PathBuf::from("/opt/tangram")]);
	let prefixes = roots
		.map(|path| regex::escape(&path.to_string_lossy()))
		.collect::<Vec<_>>()
		.join("|");
	let pattern = format!(
		r"(?:{prefixes})/(?:store|checkouts)/(?:dir_|fil_|sym_)01[0123456789abcdefghjkmnpqrstvwxyz]{{52}}"
	);
	let pattern = regex::Regex::new(&pattern)
		.map_err(|error| tg::error!(!error, "failed to build the artifact reference pattern"))?;
	Ok(pattern)
}
