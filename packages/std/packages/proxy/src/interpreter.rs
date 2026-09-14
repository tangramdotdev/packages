use tangram_client::prelude::*;

/// Decode shell words and recover artifact paths in loader arguments.
pub async fn interpreter_args(
	raw: &str,
	mut template_from_path: impl AsyncFnMut(&str) -> tg::Result<tg::Template>,
) -> tg::Result<Vec<tg::Template>> {
	let words =
		shlex::split(raw).ok_or_else(|| tg::error!("invalid quoting in TGLD_INTERPRETER_ARGS"))?;
	let mut args = Vec::new();
	let mut previous = "";
	for word in &words {
		if !crate::is_store_path(word) {
			args.push(tg::Template::from(word.as_str()));
			previous = word;
			continue;
		}
		let (prefix, value) = word
			.split_once('=')
			.filter(|(option, _)| option.starts_with('-'))
			.map_or(("", word.as_str()), |(option, value)| {
				(&word[..=option.len()], value)
			});
		let option = prefix.strip_suffix('=').unwrap_or(previous);
		let separators: &[char] = match option {
			"--library-path" | "--audit" => &[':'],
			"--preload" => &[':', ' '],
			_ => &[],
		};
		let mut template = tg::Template::builder().string(prefix);
		for part in value.split_inclusive(separators) {
			let (path, separator) = part
				.strip_suffix(separators)
				.map_or((part, ""), |path| (path, &part[path.len()..]));
			if crate::is_store_path(path) {
				if !std::path::Path::new(path).is_absolute() {
					return Err(tg::error!(
						"unsupported embedded path in TGLD_INTERPRETER_ARGS"
					));
				}
				template = template.components(template_from_path(path).await?.components);
			} else {
				template = template.string(path);
			}
			template = template.string(separator);
		}
		args.push(template.build());
		previous = word;
	}
	Ok(args)
}
