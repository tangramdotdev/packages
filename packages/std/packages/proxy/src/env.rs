use tangram_client::prelude::*;

/// Recover embedded artifact references from the live environment value.
pub async fn environment_value(
	name: &str,
	raw: &str,
	template_from_path: impl AsyncFnMut(&str) -> tg::Result<tg::Template>,
) -> tg::Result<tg::Value> {
	let template = crate::template_from_string(raw, template_from_path)
		.await
		.map_err(
			|error| tg::error!(!error, variable = %name, "failed to recover environment artifacts"),
		)?;
	if template.artifacts().next().is_none() {
		Ok(raw.to_owned().into())
	} else {
		Ok(template.into())
	}
}
