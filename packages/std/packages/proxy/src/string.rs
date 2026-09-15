use tangram_client::prelude::*;

/// Recover embedded Tangram references without interpreting the surrounding text.
/// Checkin supplies identity, context, and authorization for each occurrence.
pub async fn template_from_string(
	raw: &str,
	mut template_from_path: impl AsyncFnMut(&str) -> tg::Result<tg::Template>,
) -> tg::Result<tg::Template> {
	let executable = std::env::current_exe()
		.and_then(|path| path.canonicalize())
		.map_err(|error| tg::error!(!error, "failed to locate the current executable"))?;
	let roots = executable
		.ancestors()
		.skip(1)
		.map(|path| path.join(".tangram"))
		.chain([std::path::PathBuf::from("/opt/tangram")]);
	let prefixes = roots
		.map(|path| regex::escape(&path.to_string_lossy()))
		.collect::<Vec<_>>()
		.join("|");
	let pattern = format!(
		r"(?:{prefixes})/(?:store|checkouts)/(?:dir_|fil_|sym_)01[0123456789abcdefghjkmnpqrstvwxyz]{{52}}"
	);
	let pattern = regex::Regex::new(&pattern)
		.map_err(|error| tg::error!(!error, "failed to build the artifact reference pattern"))?;
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
