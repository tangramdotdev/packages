use tangram_client::prelude::*;

/// Decode shell words and recover their embedded artifact references.
pub async fn interpreter_args(
	raw: &str,
	mut template_from_path: impl AsyncFnMut(&str) -> tg::Result<tg::Template>,
) -> tg::Result<Vec<tg::Template>> {
	let words =
		shlex::split(raw).ok_or_else(|| tg::error!("invalid quoting in TANGRAM_LINKER_INTERPRETER_ARGS"))?;
	let mut args = Vec::with_capacity(words.len());
	for word in words {
		args.push(crate::template_from_string(&word, &mut template_from_path).await?);
	}
	Ok(args)
}
