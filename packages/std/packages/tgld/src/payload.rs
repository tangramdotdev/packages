use tangram_client::prelude::*;

type Result<T> = std::result::Result<T, &'static str>;

pub fn args(raw: &str) -> Result<Vec<tg::Template>> {
	let raw = frame(raw)?;
	let value = raw
		.parse::<tg::Value>()
		.map_err(|_| "a Tangram array of templates")?;
	let tg::Value::Array(values) = value else {
		return Err("an array of templates");
	};
	let mut args = Vec::new();
	for value in values {
		let tg::Value::Template(value) = value else {
			return Err("an array of templates");
		};
		validate_template(&value)?;
		args.push(value);
	}
	Ok(args)
}

pub fn env(raw: &str) -> Result<tg::Mutation> {
	let raw = frame(raw)?;
	let value = raw
		.parse::<tg::Value>()
		.map_err(|_| "a Tangram environment mutation")?;
	let tg::Value::Mutation(mut mutation) = value else {
		return Err("an outer set or unset environment mutation");
	};
	match &mut mutation {
		tg::Mutation::Set { value } => {
			let tg::Value::Map(map) = value.as_mut() else {
				return Err("an outer set mutation containing a map");
			};
			for value in map.values_mut() {
				validate_value(value)?;
			}
		},
		tg::Mutation::Unset => {},
		_ => return Err("an outer set or unset environment mutation"),
	}
	Ok(mutation)
}

// The pinned value parser accepts a prefix; check framing locally before delegating its grammar.
fn frame(raw: &str) -> Result<&str> {
	let raw = raw.trim_matches([' ', '\t', '\r', '\n']);
	let mut depth = 0_usize;
	let mut quoted = false;
	let mut escaped = false;
	for (offset, byte) in raw.bytes().enumerate() {
		if quoted {
			if escaped {
				escaped = false;
			} else if byte == b'\\' {
				escaped = true;
			} else if byte == b'"' {
				quoted = false;
			}
			continue;
		}
		match byte {
			b'"' => quoted = true,
			b'(' | b'[' | b'{' => depth += 1,
			b')' | b']' | b'}' => {
				depth = depth
					.checked_sub(1)
					.ok_or("a payload with balanced delimiters")?;
				if depth == 0 {
					return if offset + 1 == raw.len() {
						Ok(raw)
					} else {
						Err("a single complete payload without trailing tokens")
					};
				}
			},
			_ => {},
		}
	}
	Err("a complete payload with terminated strings and balanced delimiters")
}

fn validate_value(value: &mut tg::Value) -> Result<()> {
	if let tg::Value::Mutation(mutation) = value {
		validate_mutation(mutation)?;
	} else {
		validate_renderable(value)?;
	}
	Ok(())
}

fn validate_mutation(mutation: &mut tg::Mutation) -> Result<()> {
	match mutation {
		tg::Mutation::Append { values } | tg::Mutation::Prepend { values } => {
			if !values
				.iter()
				.all(|value| matches!(value, tg::Value::String(_)))
			{
				return Err("strings in an append or prepend mutation");
			}
		},
		tg::Mutation::Merge { .. } => {
			return Err("a supported per-variable environment mutation");
		},
		tg::Mutation::Prefix { template, .. } | tg::Mutation::Suffix { template, .. } => {
			validate_template(template)?;
		},
		tg::Mutation::Set { value } | tg::Mutation::SetIfUnset { value } => {
			validate_renderable(value)?;
		},
		tg::Mutation::Unset => {},
	}
	Ok(())
}

fn validate_renderable(value: &mut tg::Value) -> Result<()> {
	match value {
		tg::Value::Bool(_) | tg::Value::Null | tg::Value::Number(_) | tg::Value::String(_) => {},
		tg::Value::Object(object) => {
			let artifact = tg::Artifact::try_from(object.clone())
				.map_err(|_| "an artifact environment value")?;
			*value = tg::Value::Template(common::template_from_artifact(artifact));
		},
		tg::Value::Template(template) => validate_template(template)?,
		_ => return Err("a renderable scalar, artifact, or template environment value"),
	}
	Ok(())
}

fn validate_template(template: &tg::Template) -> Result<()> {
	for component in &template.components {
		match component {
			tg::template::Component::Artifact(_) | tg::template::Component::String(_) => {},
			tg::template::Component::Placeholder(_) => {
				return Err("a template without unresolved placeholders");
			},
		}
	}
	Ok(())
}

#[cfg(test)]
mod tests;
