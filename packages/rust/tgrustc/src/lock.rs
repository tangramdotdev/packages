use std::{
	collections::{BTreeMap, BTreeSet, VecDeque},
	fs,
	path::{Path, PathBuf},
};

#[derive(serde::Deserialize)]
struct Lockfile {
	#[serde(default)]
	package: Vec<Package>,
}

#[derive(serde::Deserialize)]
struct Package {
	name: String,
	#[serde(default)]
	dependencies: Vec<String>,
}

// The packages reachable from `direct_stems`, or `None` when the lockfile
// cannot be found or does not explain every stem the walk reaches. Absent an
// edge list a package's transitive dependencies are unknown, and filtering the
// search path on a guess would hide an rlib rustc needs, so the caller must not
// filter at all. Names are normalized so `num-traits` and `num_traits` unify.
#[must_use]
pub fn closure(root: &Path, direct_stems: &[String]) -> Option<BTreeSet<String>> {
	let path = find(root)?;
	let text = fs::read_to_string(path).ok()?;
	let graph = parse(&text)?;

	// Each stem must resolve under one of its readings, or the lockfile does
	// not describe this compilation and cannot bound it.
	let mut queue: VecDeque<String> = VecDeque::new();
	for stem in direct_stems {
		let mut resolved = false;
		for name in package_names(stem) {
			if graph.contains_key(&name) {
				queue.push_back(name);
				resolved = true;
			}
		}
		if !resolved {
			return None;
		}
	}

	let mut visited: BTreeSet<String> = BTreeSet::new();
	while let Some(name) = queue.pop_front() {
		if !visited.insert(name.clone()) {
			continue;
		}
		// A lockfile is closed over its own edges, so a miss here means the
		// file does not describe the whole graph.
		let dependencies = graph.get(&name)?;
		for dependency in dependencies {
			if !visited.contains(dependency) {
				queue.push_back(dependency.clone());
			}
		}
	}

	Some(visited)
}

// Library outputs are `lib<crate><extra-filename>` and bin and proc-macro
// outputs are `<crate><extra-filename>`, so the `lib` prefix is not recoverable
// from the stem alone. Offer both readings and let the caller accept a match on
// either, which over-approximates in the safe direction.
#[must_use]
pub fn package_names(stem: &str) -> Vec<String> {
	let base = stem.rsplit_once('-').map_or(stem, |(base, _)| base);
	let mut names = vec![normalize(base)];
	if let Some(stripped) = base.strip_prefix("lib") {
		names.push(normalize(stripped));
	}
	names
}

fn find(root: &Path) -> Option<PathBuf> {
	root.ancestors()
		.map(|dir| dir.join("Cargo.lock"))
		.find(|path| path.is_file())
}

// A package can appear under several versions and a stem carries no version, so
// merge the edges of every version under one name and over-approximate.
fn parse(text: &str) -> Option<BTreeMap<String, BTreeSet<String>>> {
	let lockfile: Lockfile = toml::from_str(text).ok()?;
	let mut graph: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
	for package in lockfile.package {
		// A dependency entry is `name`, `name version`, or `name version (source)`.
		let dependencies = package.dependencies.iter().map(|dependency| {
			normalize(dependency.split_whitespace().next().unwrap_or(dependency))
		});
		graph
			.entry(normalize(&package.name))
			.or_default()
			.extend(dependencies);
	}
	Some(graph)
}

// Cargo names packages with hyphens and rustc names crates with underscores.
fn normalize(name: &str) -> String {
	name.replace('-', "_")
}

#[cfg(test)]
mod tests {
	use super::*;

	const LOCKFILE: &str = r#"
version = 4

[[package]]
name = "cli"
version = "0.1.0"
dependencies = [
 "num-traits",
 "signal-hook-registry 1.4.1 (registry+https://github.com/rust-lang/crates.io-index)",
]

[[package]]
name = "num-traits"
version = "0.2.19"
dependencies = [
 "autocfg",
]

[[package]]
name = "autocfg"
version = "1.4.0"

[[package]]
name = "signal-hook-registry"
version = "1.4.1"

[[package]]
name = "unrelated"
version = "1.0.0"
"#;

	fn graph() -> BTreeMap<String, BTreeSet<String>> {
		parse(LOCKFILE).unwrap()
	}

	#[test]
	fn parses_every_dependency_entry_form() {
		let graph = graph();
		assert_eq!(
			graph.get("cli").unwrap(),
			&BTreeSet::from(["num_traits".to_owned(), "signal_hook_registry".to_owned()])
		);
		assert!(graph.get("autocfg").unwrap().is_empty());
	}

	#[test]
	fn merges_the_versions_of_one_package() {
		let text = r#"
[[package]]
name = "syn"
version = "1.0.0"
dependencies = ["proc-macro2"]

[[package]]
name = "syn"
version = "2.0.0"
dependencies = ["quote"]
"#;
		let graph = parse(text).unwrap();
		assert_eq!(
			graph.get("syn").unwrap(),
			&BTreeSet::from(["proc_macro2".to_owned(), "quote".to_owned()])
		);
	}

	#[test]
	fn package_names_offers_both_readings() {
		assert_eq!(
			package_names("liblibc-1de91543535344de"),
			["liblibc", "libc"]
		);
		assert_eq!(
			package_names("libsignal_hook_registry-5eca2"),
			["libsignal_hook_registry", "signal_hook_registry"]
		);
		// A bin or proc-macro stem carries no `lib` prefix to strip.
		assert_eq!(package_names("cli-abc123"), ["cli"]);
	}

	#[test]
	fn walks_the_transitive_closure() {
		let mut visited = BTreeSet::new();
		let mut queue: VecDeque<String> = ["cli".to_owned()].into();
		let graph = graph();
		while let Some(name) = queue.pop_front() {
			if visited.insert(name.clone()) {
				queue.extend(graph.get(&name).unwrap().iter().cloned());
			}
		}
		assert!(visited.contains("autocfg"), "reached through num-traits");
		assert!(!visited.contains("unrelated"));
	}
}
