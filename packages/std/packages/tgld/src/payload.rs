use tangram_client::prelude::*;

type Result<T> = std::result::Result<T, &'static str>;

pub fn args(raw: &str) -> Result<Vec<tg::Template>> {
	let raw = frame(raw, false)?;
	let value = raw
		.parse::<tg::Value>()
		.map_err(|_| "a Tangram array of templates")?;
	let tg::value::Data::Array(values) = value.to_data() else {
		return Err("an array of templates");
	};
	let mut args = Vec::new();
	for value in values {
		let tg::value::Data::Template(mut value) = value else {
			return Err("an array of templates");
		};
		validate_template(&mut value)?;
		args.push(tg::Template::try_from_data(value).map_err(|_| "a renderable template")?);
	}
	Ok(args)
}

pub fn env(raw: &str) -> Result<tg::Mutation> {
	let raw = frame(raw, true)?;
	let value = raw
		.parse::<tg::Value>()
		.map_err(|_| "a Tangram environment mutation")?;
	let tg::value::Data::Mutation(mut mutation) = value.to_data() else {
		return Err("an outer set or unset environment mutation");
	};
	match &mut mutation {
		tg::mutation::Data::Set { value } => {
			let tg::value::Data::Map(map) = value.as_mut() else {
				return Err("an outer set mutation containing a map");
			};
			for value in map.values_mut() {
				validate_value(value)?;
			}
		},
		tg::mutation::Data::Unset => {},
		_ => return Err("an outer set or unset environment mutation"),
	}
	tg::Mutation::try_from_data(mutation).map_err(|_| "a renderable environment mutation")
}

// The pinned value parser accepts a prefix; check framing locally before delegating its grammar.
fn frame(raw: &str, mutation: bool) -> Result<&str> {
	let whitespace = |ch| matches!(ch, ' ' | '\t' | '\r' | '\n');
	let raw = raw.trim_matches(whitespace);
	let start = if mutation {
		let mut remaining = raw;
		for token in ["tg", ".", "mutation"] {
			remaining = remaining
				.strip_prefix(token)
				.ok_or("a complete tg.mutation(...) expression")?
				.trim_start_matches(whitespace);
		}
		if !remaining.starts_with('(') {
			return Err("a complete tg.mutation(...) expression");
		}
		raw.len() - remaining.len()
	} else {
		if !raw.starts_with('[') {
			return Err("a complete array expression");
		}
		0
	};
	let mut stack = Vec::new();
	let mut quoted = false;
	let mut escaped = false;
	for (offset, byte) in raw.bytes().enumerate().skip(start) {
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
			b'(' => stack.push(b')'),
			b'[' => stack.push(b']'),
			b'{' => stack.push(b'}'),
			b')' | b']' | b'}' => {
				if stack.pop() != Some(byte) {
					return Err("a payload with balanced delimiters");
				}
				if stack.is_empty() {
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

fn validate_value(value: &mut tg::value::Data) -> Result<()> {
	if let tg::value::Data::Mutation(mutation) = value {
		validate_mutation(mutation)?;
	} else {
		validate_renderable(value)?;
	}
	Ok(())
}

fn validate_mutation(mutation: &mut tg::mutation::Data) -> Result<()> {
	match mutation {
		tg::mutation::Data::Append { values } | tg::mutation::Data::Prepend { values } => {
			if !values
				.iter()
				.all(|value| matches!(value, tg::value::Data::String(_)))
			{
				return Err("strings in an append or prepend mutation");
			}
		},
		tg::mutation::Data::Merge { .. } => {
			return Err("a supported per-variable environment mutation");
		},
		tg::mutation::Data::Prefix { template, .. }
		| tg::mutation::Data::Suffix { template, .. } => validate_template(template)?,
		tg::mutation::Data::Set { value } | tg::mutation::Data::SetIfUnset { value } => {
			validate_renderable(value)?;
		},
		tg::mutation::Data::Unset => {},
	}
	Ok(())
}

fn validate_renderable(value: &mut tg::value::Data) -> Result<()> {
	match value {
		tg::value::Data::Bool(_)
		| tg::value::Data::Null
		| tg::value::Data::Number(_)
		| tg::value::Data::String(_) => {},
		tg::value::Data::Object(referent) => {
			let referent = referent
				.clone()
				.try_map(tg::artifact::Id::try_from)
				.map_err(|_| "an artifact environment value")?;
			let template = proxy::template_from_referent(&referent)
				.map_err(|_| "an authorized artifact root and string subpath")?;
			*value = tg::value::Data::Template(template.to_data());
		},
		tg::value::Data::Template(template) => validate_template(template)?,
		_ => return Err("a renderable scalar, artifact, or template environment value"),
	}
	Ok(())
}

fn validate_template(template: &mut tg::template::Data) -> Result<()> {
	let mut components = Vec::new();
	for component in &template.components {
		match component {
			tg::template::data::Component::Artifact(referent) => {
				let template = proxy::template_from_referent(referent)
					.map_err(|_| "an authorized artifact root and string subpath")?;
				components.extend(template.to_data().components);
			},
			tg::template::data::Component::Placeholder(_) => {
				return Err("a template without unresolved placeholders");
			},
			tg::template::data::Component::String(_) => components.push(component.clone()),
		}
	}
	template.components = components;
	Ok(())
}

#[cfg(test)]
mod tests;
