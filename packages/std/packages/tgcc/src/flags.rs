use tangram_client::prelude::*;

// C/C++ compiler flag environment values retain their shell word spelling.
pub(super) async fn compiler_flags(raw: &str) -> tg::Result<tg::Value> {
	let mut components = Vec::new();
	let mut end = 0;
	for range in flag_words(raw)? {
		let word = &raw[range.clone()];
		let words =
			shlex::split(word).ok_or_else(|| tg::error!("invalid quoting in compiler flags"))?;
		let [decoded] = words.as_slice() else {
			continue;
		};
		if !common::is_store_path(decoded) {
			continue;
		}
		components.push(tg::template::Component::String(
			raw[end..range.start].to_owned(),
		));
		let (prefix, path) = [
			"-I",
			"-L",
			"-B",
			"--sysroot=",
			"-isystem",
			"-iquote",
			"-idirafter",
			"-include",
			"-imacros",
			"-isysroot",
			"-Wl,-rpath-link,",
			"-Wl,-rpath,",
			"-Wl,-dynamic-linker=",
		]
		.into_iter()
		.find_map(|prefix| decoded.strip_prefix(prefix).map(|path| (prefix, path)))
		.unwrap_or(("", decoded));
		let separator = matches!(prefix, "-Wl,-rpath-link," | "-Wl,-rpath,").then_some(':');
		let mut template = tg::Template::builder().string(prefix).build();
		for (index, path) in path.split(|c| Some(c) == separator).enumerate() {
			if index > 0 {
				template
					.components
					.push(tg::template::Component::String(":".into()));
			}
			if common::is_store_path(path) {
				if !std::path::Path::new(path).is_absolute() {
					return Err(tg::error!(
						"unsupported embedded store path in compiler flags"
					));
				}
				template
					.components
					.extend(common::template_from_path(path).await?.components);
			} else {
				template
					.components
					.push(tg::template::Component::String(path.into()));
			}
		}
		// Preserve plain words for consumers that split flags without shell unquoting.
		// Re-quote decoded words as a whole, escaping apostrophes in path suffixes.
		if word != decoded {
			components.push(tg::template::Component::String("'".into()));
			for component in &mut template.components {
				if let tg::template::Component::String(string) = component {
					*string = string.replace('\'', "'\\''");
				}
			}
			template
				.components
				.push(tg::template::Component::String("'".into()));
		}
		components.extend(template.components);
		end = range.end;
	}
	if components.is_empty() {
		return Ok(raw.to_owned().into());
	}
	components.push(tg::template::Component::String(raw[end..].to_owned()));
	Ok(tg::Template::with_components(components).into())
}

// Locate shell words without losing their spelling or surrounding whitespace.
// shlex decodes each word; this scan only tracks quotes, escapes, and boundaries.
fn flag_words(raw: &str) -> tg::Result<Vec<std::ops::Range<usize>>> {
	let mut words = Vec::new();
	let mut start = None;
	let mut quote = None;
	let mut chars = raw.char_indices();
	while let Some((index, c)) = chars.next() {
		if quote.is_none() && matches!(c, ' ' | '\t' | '\n') {
			if let Some(start) = start.take() {
				words.push(start..index);
			}
			continue;
		}
		if quote.is_none() && start.is_none() && c == '#' {
			for (_, c) in chars.by_ref() {
				if c == '\n' {
					break;
				}
			}
			continue;
		}
		start.get_or_insert(index);
		if c == '\\' && quote != Some('\'') {
			chars
				.next()
				.ok_or_else(|| tg::error!("trailing escape in compiler flags"))?;
		} else if Some(c) == quote {
			quote = None;
		} else if quote.is_none() && matches!(c, '\'' | '"') {
			quote = Some(c);
		}
	}
	if quote.is_some() {
		return Err(tg::error!("unterminated quote in compiler flags"));
	}
	if let Some(start) = start {
		words.push(start..raw.len());
	}
	Ok(words)
}
