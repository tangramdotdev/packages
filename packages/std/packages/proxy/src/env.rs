use tangram_client::prelude::*;

/// Recover artifact paths using the variable's flag or path-list grammar.
pub async fn environment_value(
	name: &str,
	raw: &str,
	mut template_from_path: impl AsyncFnMut(&str) -> tg::Result<tg::Template>,
) -> tg::Result<tg::Value> {
	if matches!(name, "CFLAGS" | "CPPFLAGS" | "CXXFLAGS" | "LDFLAGS") {
		return crate::compiler_flags(raw, template_from_path).await;
	}
	if !crate::is_store_path(raw) {
		return Ok(raw.to_owned().into());
	}
	if name == "TGLD_INTERPRETER_ARGS" {
		let args = crate::interpreter_args(raw, template_from_path).await?;
		let mut template = tg::Template::builder();
		for (index, arg) in args.into_iter().enumerate() {
			if index > 0 {
				template = template.string(" ");
			}
			template = template.components(crate::flags::quote(arg).components);
		}
		return Ok(template.build().into());
	}
	let paths = matches!(
		name,
		"PATH"
			| "LD_LIBRARY_PATH"
			| "DYLD_LIBRARY_PATH"
			| "DYLD_FALLBACK_LIBRARY_PATH"
			| "DYLD_INSERT_LIBRARIES"
			| "LIBRARY_PATH"
			| "CPATH" | "C_INCLUDE_PATH"
			| "CPLUS_INCLUDE_PATH"
			| "OBJC_INCLUDE_PATH"
			| "PKG_CONFIG_PATH"
			| "PKG_CONFIG_LIBDIR"
			| "CMAKE_PREFIX_PATH"
			| "NODE_PATH"
	);
	let mut template = tg::Template::builder();
	for (index, path) in raw.split(|c| paths && c == ':').enumerate() {
		if index > 0 {
			template = template.string(":");
		}
		template = if crate::is_store_path(path) {
			if !std::path::Path::new(path).is_absolute() {
				return Err(tg::error!(variable = %name, "unsupported embedded environment path"));
			}
			template.components(template_from_path(path).await?.components)
		} else {
			template.string(path)
		};
	}
	Ok(template.build().into())
}
