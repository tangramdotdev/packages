use std::{
	collections::{BTreeMap, BTreeSet, VecDeque},
	fs,
	path::{Path, PathBuf},
};
use tangram_client::prelude::*;

// Each wrapper drops a sidecar listing its direct `--extern` set under this
// dir (relative to cargo's `--out-dir`). The set is the ground-truth dep graph
// for the build at hand, reflecting features and targets the lockfile alone
// cannot describe, and is the input to the BFS that filters `-L dependency=`.
const SIDECAR_DIR: &str = ".tangram-externs";

fn sidecar_path(deps_dir: &Path, stem: &str) -> PathBuf {
	deps_dir.join(SIDECAR_DIR).join(format!("{stem}.txt"))
}

pub fn direct_extern_stems(passthrough: &[String]) -> Vec<String> {
	direct_extern_stems_by_dir(passthrough)
		.into_values()
		.flatten()
		.collect()
}

// Cross-compiles route proc-macro externs through the host deps dir and
// library externs through the target deps dir; per-dir BFS roots let each
// `-L dependency=` filter resolve its closure against the right sidecars.
pub fn direct_extern_stems_by_dir(passthrough: &[String]) -> BTreeMap<PathBuf, Vec<String>> {
	let mut by_dir: BTreeMap<PathBuf, Vec<String>> = BTreeMap::new();
	let mut iter = passthrough.iter();
	while let Some(arg) = iter.next() {
		if arg != "--extern" {
			continue;
		}
		let Some(value) = iter.next() else { continue };
		let Some((_, path)) = value.split_once('=') else {
			continue;
		};
		let extern_path = Path::new(path);
		let Some(stem) = extern_path
			.file_stem()
			.and_then(|s| s.to_str())
			.map(str::to_owned)
		else {
			continue;
		};
		let Some(parent) = extern_path.parent() else {
			continue;
		};
		by_dir.entry(parent.to_path_buf()).or_default().push(stem);
	}
	by_dir
}

// Artifact builds may isolate crates in separate dependency directories.
pub fn dependency_dirs(passthrough: &[String]) -> BTreeSet<PathBuf> {
	let mut dirs: BTreeSet<PathBuf> = direct_extern_stems_by_dir(passthrough)
		.into_keys()
		.collect();
	let mut iter = passthrough.iter();
	while let Some(arg) = iter.next() {
		if arg != "-L" {
			continue;
		}
		let Some(value) = iter.next() else { continue };
		let Some(path) = value.strip_prefix("dependency=") else {
			continue;
		};
		dirs.insert(PathBuf::from(path));
	}
	dirs
}

// Library outputs are `lib<crate><extra-filename>`; bin outputs are
// `<crate><extra-filename>`. Write both so consumers find the sidecar
// regardless of which form their `--extern` value points at.
pub fn own_stems(crate_name: Option<&str>, extra_filename: Option<&str>) -> Vec<String> {
	let (Some(name), Some(suffix)) = (crate_name, extra_filename) else {
		return Vec::new();
	};
	vec![format!("lib{name}{suffix}"), format!("{name}{suffix}")]
}

pub fn write_sidecars(
	deps_dir: &Path,
	own_stems: &[String],
	extern_stems: &[String],
) -> tg::Result<()> {
	if own_stems.is_empty() {
		return Ok(());
	}
	let dir = deps_dir.join(SIDECAR_DIR);
	fs::create_dir_all(&dir)
		.map_err(|error| tg::error!("failed to create sidecar dir {}: {error}", dir.display()))?;
	// Always write a sidecar — even an empty one — so leaf crates signal "no
	// transitive deps" rather than "compiled outside the proxy" to the BFS.
	let body = extern_stems.join("\n");
	for stem in own_stems {
		let path = sidecar_path(deps_dir, stem);
		fs::write(&path, &body)
			.map_err(|error| tg::error!("failed to write sidecar {}: {error}", path.display()))?;
	}
	Ok(())
}

// Returns the reachable stem set and whether every visited stem had a sidecar.
// An incomplete closure (some stem compiled outside the proxy left no sidecar)
// makes the caller fall back to an unfiltered snapshot. A sidecar lookup
// checks each `deps_dirs` entry in order and returns the first hit, so
// cross-compile setups (target + host `-L` dirs) resolve a stem's deps
// regardless of which dir the sidecar lives in.
pub fn closure_from_sidecars(
	deps_dirs: &[&Path],
	direct_stems: &[String],
) -> (BTreeSet<String>, bool) {
	let mut visited: BTreeSet<String> = BTreeSet::new();
	let mut queue: VecDeque<String> = direct_stems.iter().cloned().collect();
	let mut complete = true;
	while let Some(stem) = queue.pop_front() {
		if !visited.insert(stem.clone()) {
			continue;
		}
		let mut found = false;
		for dir in deps_dirs {
			if let Some(deps) = read_sidecar(dir, &stem) {
				found = true;
				for dep in deps {
					if !visited.contains(&dep) {
						queue.push_back(dep);
					}
				}
				break;
			}
		}
		if !found {
			complete = false;
		}
	}
	(visited, complete)
}

fn read_sidecar(deps_dir: &Path, stem: &str) -> Option<Vec<String>> {
	let text = fs::read_to_string(sidecar_path(deps_dir, stem)).ok()?;
	Some(
		text.lines()
			.map(str::trim)
			.filter(|s| !s.is_empty())
			.map(str::to_owned)
			.collect(),
	)
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn writes_then_reads_a_sidecar() {
		let temp = tempfile::tempdir().unwrap();
		let dir = temp.path();
		write_sidecars(
			dir,
			&["libfoo-abc123".to_owned()],
			&["libbar-def456".to_owned(), "libbaz-789abc".to_owned()],
		)
		.unwrap();
		write_sidecars(dir, &["libbar-def456".to_owned()], &[]).unwrap();
		write_sidecars(dir, &["libbaz-789abc".to_owned()], &[]).unwrap();
		let (visited, complete) = closure_from_sidecars(&[dir], &["libfoo-abc123".to_owned()]);
		assert!(complete);
		assert_eq!(
			visited,
			BTreeSet::from([
				"libfoo-abc123".to_owned(),
				"libbar-def456".to_owned(),
				"libbaz-789abc".to_owned(),
			])
		);
	}

	#[test]
	fn missing_sidecar_marks_incomplete() {
		let temp = tempfile::tempdir().unwrap();
		let (_visited, complete) =
			closure_from_sidecars(&[temp.path()], &["libfoo-abc123".to_owned()]);
		assert!(!complete);
	}

	#[test]
	fn empty_stems_yield_empty_complete_closure() {
		let temp = tempfile::tempdir().unwrap();
		let (visited, complete) = closure_from_sidecars(&[temp.path()], &[]);
		assert!(complete);
		assert!(visited.is_empty());
	}

	#[test]
	fn direct_extern_stems_extracts_lib_stems() {
		let pass = vec![
			"--crate-name".to_owned(),
			"signal_hook".to_owned(),
			"--extern".to_owned(),
			"libc=/some/path/liblibc-1de91543535344de.rmeta".to_owned(),
			"--extern".to_owned(),
			"errno".to_owned(),
			"--extern".to_owned(),
			"signal_hook_registry=/x/libsignal_hook_registry-5eca2.rmeta".to_owned(),
		];
		let mut stems = direct_extern_stems(&pass);
		stems.sort();
		assert_eq!(
			stems,
			vec![
				"liblibc-1de91543535344de".to_owned(),
				"libsignal_hook_registry-5eca2".to_owned(),
			]
		);
	}

	#[test]
	fn dependency_dirs_include_extern_parents_and_search_paths() {
		let pass = vec![
			"--extern".to_owned(),
			"direct=/outputs/direct/libdirect-abc123.rmeta".to_owned(),
			"-L".to_owned(),
			"dependency=/outputs/transitive".to_owned(),
			"-L".to_owned(),
			"native=/native/lib".to_owned(),
		];
		assert_eq!(
			dependency_dirs(&pass),
			BTreeSet::from([
				PathBuf::from("/outputs/direct"),
				PathBuf::from("/outputs/transitive"),
			])
		);
	}

	#[test]
	fn walks_sidecars_across_isolated_dependency_dirs() {
		let temp = tempfile::tempdir().unwrap();
		let regex_dir = temp.path().join("regex-automata");
		let aho_dir = temp.path().join("aho-corasick");
		let memchr_dir = temp.path().join("memchr");
		let syntax_dir = temp.path().join("regex-syntax");

		write_sidecars(
			&regex_dir,
			&["libregex_automata-regex".to_owned()],
			&[
				"libaho_corasick-aho".to_owned(),
				"libmemchr-memchr".to_owned(),
				"libregex_syntax-syntax".to_owned(),
			],
		)
		.unwrap();
		write_sidecars(
			&aho_dir,
			&["libaho_corasick-aho".to_owned()],
			&["libmemchr-memchr".to_owned()],
		)
		.unwrap();
		write_sidecars(&memchr_dir, &["libmemchr-memchr".to_owned()], &[]).unwrap();
		write_sidecars(&syntax_dir, &["libregex_syntax-syntax".to_owned()], &[]).unwrap();

		let dirs = [&regex_dir, &aho_dir, &memchr_dir, &syntax_dir].map(PathBuf::as_path);
		let (visited, complete) =
			closure_from_sidecars(&dirs, &["libregex_automata-regex".to_owned()]);
		assert!(complete);
		assert_eq!(
			visited,
			BTreeSet::from([
				"libaho_corasick-aho".to_owned(),
				"libmemchr-memchr".to_owned(),
				"libregex_automata-regex".to_owned(),
				"libregex_syntax-syntax".to_owned(),
			])
		);
	}
}
