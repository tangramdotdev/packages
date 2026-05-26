use std::{collections::BTreeMap, path::Path};
use tangram_client::prelude::*;

// Produce a workspace artifact where every sibling member's `.rs` files are
// replaced with a placeholder. The result hashes stably across sibling source
// edits, so the runner's command id stays cache-warm when an unrelated
// workspace member changes, while preserving the workspace directory shape so
// build scripts that read `..` (Cargo.toml, shared config files, etc.) still
// see real content.
pub async fn filter(
	workspace: tg::Directory,
	current_crate_subpath: &str,
) -> tg::Result<tg::Directory> {
	let cargo_toml = match workspace.try_get("Cargo.toml").await? {
		Some(tg::Artifact::File(file)) => file,
		_ => return Ok(workspace),
	};
	let cargo_toml_text = cargo_toml.read_to_string().await?;
	let members = parse_members(&cargo_toml_text);
	let siblings: Vec<&str> = members
		.iter()
		.map(String::as_str)
		.filter(|m| *m != current_crate_subpath)
		.collect();
	if siblings.is_empty() {
		return Ok(workspace);
	}

	let placeholder = placeholder_artifact().await?;

	let mut builder = workspace.to_builder().await?;
	for sibling in siblings {
		let entry = workspace.try_get(sibling).await?;
		let Some(tg::Artifact::Directory(dir)) = entry else {
			continue;
		};
		let filtered = replace_rs(dir, &placeholder).await?;
		builder = builder.add(Path::new(sibling), filtered.into()).await?;
	}
	Ok(builder.build())
}

async fn placeholder_artifact() -> tg::Result<tg::Artifact> {
	let blob = tg::Blob::with_reader(std::io::Cursor::new(b"// placeholder\n")).await?;
	let file = tg::File::builder()
		.contents(blob)
		.build()
		.map_err(|error| tg::error!(!error, "failed to build the placeholder file"))?;
	Ok(file.into())
}

async fn replace_rs(dir: tg::Directory, placeholder: &tg::Artifact) -> tg::Result<tg::Directory> {
	let entries = dir.entries().await?;
	let mut new_entries: BTreeMap<String, tg::Artifact> = BTreeMap::new();
	for (name, artifact) in entries {
		let replacement = if Path::new(&name)
			.extension()
			.is_some_and(|ext| ext.eq_ignore_ascii_case("rs"))
		{
			placeholder.clone()
		} else if let tg::Artifact::Directory(sub) = artifact {
			Box::pin(replace_rs(sub, placeholder)).await?.into()
		} else {
			artifact
		};
		new_entries.insert(name, replacement);
	}
	Ok(tg::Directory::with_entries(new_entries))
}

// Parse `[workspace] members = [...]` from a Cargo.toml document. Globs and
// excludes are ignored: the filter is best-effort and a missing member just
// means that subtree contributes to the cache key.
fn parse_members(text: &str) -> Vec<String> {
	let Ok(doc) = text.parse::<toml_edit::DocumentMut>() else {
		return Vec::new();
	};
	let Some(array) = doc
		.get("workspace")
		.and_then(|v| v.get("members"))
		.and_then(|v| v.as_array())
	else {
		return Vec::new();
	};
	array
		.iter()
		.filter_map(|item| item.as_str())
		.filter(|s| !s.contains(['*', '?', '[']))
		.map(str::to_owned)
		.collect()
}

#[cfg(test)]
mod tests {
	use super::parse_members;

	#[test]
	fn parses_explicit_members() {
		let toml = r#"
[workspace]
members = ["packages/lib", "packages/app"]
"#;
		assert_eq!(
			parse_members(toml),
			vec!["packages/lib".to_owned(), "packages/app".to_owned()],
		);
	}

	#[test]
	fn skips_glob_members() {
		let toml = r#"
[workspace]
members = ["crates/*", "tools/special"]
"#;
		assert_eq!(parse_members(toml), vec!["tools/special".to_owned()]);
	}

	#[test]
	fn empty_on_missing_workspace_table() {
		let toml = r#"
[package]
name = "foo"
"#;
		assert!(parse_members(toml).is_empty());
	}
}
