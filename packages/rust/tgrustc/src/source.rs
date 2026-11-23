use crate::outer;
use std::{
	collections::{BTreeMap, BTreeSet},
	path::{Component, Path, PathBuf},
};
use tangram_client::prelude::*;

#[cfg(test)]
mod tests;

// The macros that read a file at a path relative to the file that invokes them.
const INCLUDE_MACROS: [&str; 3] = ["include!", "include_bytes!", "include_str!"];

// The source that a compilation reads. It is the crate's directory, unless the crate includes files from outside of its directory, in which case it is a skeleton of the Cargo source that holds the crate's directory and only those files.
pub struct Source {
	pub artifact: tg::Artifact,
	pub directory: PathBuf,
	pub path: Option<PathBuf>,
}

// A directory tree under construction, whose leaves are artifacts.
enum Node {
	Artifact(tg::Artifact),
	Directory(BTreeMap<String, Node>),
}

// Check in the source of the crate in `crate_directory`.
pub async fn checkin(crate_directory: &Path) -> tg::Result<Source> {
	// Check in the crate's directory.
	let crate_artifact =
		tg::Artifact::with_referent(outer::checkin(crate_directory).await?.artifact);

	// Find the files that the crate includes from elsewhere in the Cargo source.
	let source_directory = std::env::var_os("TGRUSTC_SOURCE_DIR").map(PathBuf::from);
	let files = match &source_directory {
		Some(source_directory) => external_files(crate_directory, source_directory)?,
		None => BTreeSet::new(),
	};
	let Some(source_directory) = source_directory.filter(|_| !files.is_empty()) else {
		let source = Source {
			artifact: crate_artifact,
			directory: crate_directory.to_owned(),
			path: None,
		};
		return Ok(source);
	};

	// Place the crate's directory and each file at its path in the Cargo source.
	let crate_path = crate_directory
		.strip_prefix(&source_directory)
		.map_err(|_| tg::error!("expected the crate to be in the Cargo source"))?
		.to_owned();
	let mut root = BTreeMap::new();
	insert(&mut root, &crate_path, crate_artifact)?;
	for file in files {
		let artifact = tg::Artifact::with_referent(outer::checkin(&file).await?.artifact);
		let path = file
			.strip_prefix(&source_directory)
			.map_err(|_| tg::error!("expected an included file to be in the Cargo source"))?;
		insert(&mut root, path, artifact)?;
	}
	let artifact = build(root);
	artifact.store().await?;

	let source = Source {
		artifact,
		directory: source_directory,
		path: Some(crate_path),
	};

	Ok(source)
}

impl Source {
	// Get the template for a path in the crate's directory in the sandbox, which has no string component for the crate's directory itself when the source is the crate's directory.
	#[must_use]
	pub fn crate_template(&self, suffix: &str) -> tg::Template {
		let path = self
			.path
			.as_ref()
			.map_or_else(String::new, |path| format!("/{}", path.display()));
		let path = format!("{path}{suffix}");
		let mut components = vec![tg::template::Component::Artifact(self.artifact.clone())];
		if !path.is_empty() {
			components.push(tg::template::Component::String(path));
		}
		tg::Template::with_components(components)
	}
}

// Find the files outside of the crate's directory and inside the Cargo source that the crate's Rust files include with a literal path, following included Rust files.
fn external_files(
	crate_directory: &Path,
	source_directory: &Path,
) -> tg::Result<BTreeSet<PathBuf>> {
	// A crate at the root of the Cargo source has nothing outside of it to include.
	if !crate_directory.starts_with(source_directory) || crate_directory == source_directory {
		return Ok(BTreeSet::new());
	}

	// Scan the crate's Rust files, and each Rust file that they include, for paths.
	let mut pending = rust_files(crate_directory)?;
	let mut scanned = BTreeSet::new();
	let mut files = BTreeSet::new();
	while let Some(file) = pending.pop() {
		if !scanned.insert(file.clone()) {
			continue;
		}
		let Ok(text) = std::fs::read_to_string(&file) else {
			continue;
		};
		let Some(parent) = file.parent() else {
			continue;
		};
		for path in included_paths(&text) {
			let path = normalize(&parent.join(path));
			if !path.starts_with(source_directory) || !path.is_file() {
				continue;
			}
			if path.extension().is_some_and(|extension| extension == "rs") {
				pending.push(path.clone());
			}
			if !path.starts_with(crate_directory) {
				files.insert(path);
			}
		}
	}

	Ok(files)
}

// List the Rust files in a directory recursively, skipping hidden directories and Cargo's target directory.
fn rust_files(directory: &Path) -> tg::Result<Vec<PathBuf>> {
	let mut files = Vec::new();
	let mut pending = vec![directory.to_owned()];
	while let Some(directory) = pending.pop() {
		let entries = std::fs::read_dir(&directory).map_err(
			|source| tg::error!(!source, path = %directory.display(), "failed to read the directory"),
		)?;
		for entry in entries {
			let entry =
				entry.map_err(|source| tg::error!(!source, "failed to read a directory entry"))?;
			let path = entry.path();
			let file_type = entry
				.file_type()
				.map_err(|source| tg::error!(!source, "failed to get the file type"))?;
			let name = entry.file_name();
			if file_type.is_dir() {
				if name != "target" && !name.to_string_lossy().starts_with('.') {
					pending.push(path);
				}
			} else if file_type.is_file()
				&& path.extension().is_some_and(|extension| extension == "rs")
			{
				files.push(path);
			}
		}
	}
	Ok(files)
}

// Get the literal paths in the invocations of the include macros in Rust source text.
fn included_paths(text: &str) -> Vec<String> {
	let mut paths = Vec::new();
	for name in INCLUDE_MACROS {
		for (index, _) in text.match_indices(name) {
			// Skip a longer identifier that ends with the macro's name.
			let before = text[..index].chars().next_back();
			if before.is_some_and(|c| c.is_alphanumeric() || c == '_') {
				continue;
			}
			let rest = text[index + name.len()..].trim_start();
			let Some(rest) = rest.strip_prefix(['(', '[', '{']) else {
				continue;
			};
			if let Some(path) = string_literal(rest.trim_start()) {
				paths.push(path);
			}
		}
	}
	paths
}

// Parse a string literal without escapes, or a raw string literal, at the start of the text.
fn string_literal(text: &str) -> Option<String> {
	if let Some(rest) = text.strip_prefix('r') {
		let hashes = rest.len() - rest.trim_start_matches('#').len();
		let rest = rest[hashes..].strip_prefix('"')?;
		let terminator = format!("\"{}", "#".repeat(hashes));
		let end = rest.find(&terminator)?;
		return Some(rest[..end].to_owned());
	}
	let rest = text.strip_prefix('"')?;
	let end = rest.find('"')?;
	let literal = &rest[..end];
	if literal.contains('\\') {
		return None;
	}
	Some(literal.to_owned())
}

// Resolve the `.` and `..` components of an absolute path without reading the file system.
fn normalize(path: &Path) -> PathBuf {
	let mut normalized = PathBuf::new();
	for component in path.components() {
		match component {
			Component::CurDir => {},
			Component::Normal(_) | Component::Prefix(_) | Component::RootDir => {
				normalized.push(component);
			},
			Component::ParentDir => {
				normalized.pop();
			},
		}
	}
	normalized
}

// Insert an artifact into a directory tree at a relative path.
fn insert(
	root: &mut BTreeMap<String, Node>,
	path: &Path,
	artifact: tg::Artifact,
) -> tg::Result<()> {
	let names = path
		.components()
		.map(|component| component.as_os_str().to_string_lossy().into_owned())
		.collect::<Vec<_>>();
	let Some((last, parents)) = names.split_last() else {
		return Err(tg::error!("expected a non-empty path"));
	};
	let mut entries = root;
	for name in parents {
		let node = entries
			.entry(name.clone())
			.or_insert_with(|| Node::Directory(BTreeMap::new()));
		let Node::Directory(children) = node else {
			return Err(tg::error!(%name, "expected a directory in the source"));
		};
		entries = children;
	}
	entries.insert(last.clone(), Node::Artifact(artifact));
	Ok(())
}

// Build a directory artifact from a directory tree.
fn build(entries: BTreeMap<String, Node>) -> tg::Artifact {
	let entries = entries
		.into_iter()
		.map(|(name, node)| {
			let artifact = match node {
				Node::Artifact(artifact) => artifact,
				Node::Directory(children) => build(children),
			};
			(name, artifact)
		})
		.collect::<BTreeMap<_, _>>();
	tg::Directory::with_entries(entries).into()
}
