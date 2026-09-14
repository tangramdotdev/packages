use std::path::{Path, PathBuf};
use tangram_client::prelude::*;

/// Check in a path with its authorization and containing root/subpath context.
/// Keep the output referent until its context has been consumed; artifact handles retain only tokens and location.
pub async fn checkin_path(path: impl AsRef<Path>) -> tg::Result<tg::checkin::Output> {
	tg::checkin(tg::checkin::Arg {
		options: tg::checkin::Options {
			destructive: false,
			deterministic: true,
			ignore: false,
			lock: None,
			locked: true,
			root: true,
			..Default::default()
		},
		path: std::path::absolute(path)
			.map_err(|error| tg::error!(!error, "invalid checkin path"))?,
		updates: Vec::new(),
	})
	.await
}

/// Interpret server-provided context; never extract artifact IDs from store paths.
pub fn artifact_path(
	referent: &tg::Referent<tg::artifact::Id>,
) -> tg::Result<(tg::Artifact, Option<PathBuf>)> {
	let (id, path) = if let Some(id) = &referent.options.id {
		let id = tg::artifact::Id::try_from(id.clone())
			.map_err(|_| tg::error!("expected an artifact root in checkin referent"))?;
		(id, referent.options.path.clone())
	} else {
		(referent.node.clone(), None)
	};
	let artifact = tg::Artifact::with_referent(tg::Referent::new(
		id,
		tg::referent::Options {
			location: referent.options.location.clone(),
			tokens: referent.options.tokens.clone(),
			..Default::default()
		},
	));
	Ok((artifact, path.filter(|path| !path.as_os_str().is_empty())))
}

pub async fn template_from_path(path: impl AsRef<Path>) -> tg::Result<tg::Template> {
	let output = checkin_path(path).await?;
	let (artifact, subpath) = artifact_path(&output.artifact)?;
	Ok(match subpath {
		Some(subpath) => crate::template_from_artifact_and_subpath(artifact, subpath),
		None => crate::template_from_artifact(artifact),
	})
}

/// Only classify paths here. Checkin resolves their identity and authorization.
#[must_use]
pub fn is_store_path(path: &str) -> bool {
	[
		"/.tangram/store/",
		"/.tangram/checkouts/",
		"/opt/tangram/store/",
		"/opt/tangram/checkouts/",
	]
	.into_iter()
	.any(|prefix| path.contains(prefix))
}

/// Read the current environment string, including any shell overrides.
/// Split known path lists and unquoted compiler flags before checking in paths.
pub async fn env_value(name: &str, raw: &str) -> tg::Result<tg::Value> {
	if !is_store_path(raw) {
		return Ok(raw.to_owned().into());
	}
	let flags = matches!(name, "CFLAGS" | "CPPFLAGS" | "CXXFLAGS" | "LDFLAGS");
	if flags && raw.contains(['\'', '"', '\\']) {
		return Err(
			tg::error!(variable = %name, "unsupported quoting in compiler flags containing store paths"),
		);
	}
	let path_list = matches!(
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
	if !flags {
		let template = if path_list {
			path_list_template(raw).await
		} else {
			path_template(raw).await
		};
		return template.map(Into::into).map_err(
			|error| tg::error!(!error, variable = %name, "failed to preserve environment dependencies"),
		);
	}
	let mut components = Vec::new();
	for part in raw.split_inclusive(|c: char| c.is_ascii_whitespace()) {
		let word = part.trim_end_matches(|c: char| c.is_ascii_whitespace());
		let template = argument_template(word).await.map_err(
			|error| tg::error!(!error, variable = %name, "failed to preserve compiler flag dependencies"),
		)?;
		components.extend(template.components);
		components.push(tg::template::Component::String(
			part[word.len()..].to_owned(),
		));
	}
	Ok(tg::Template::with_components(components).into())
}

/// Arguments have already been separated by the caller; only split known path options.
pub async fn arg_value(raw: &str) -> tg::Result<tg::Value> {
	if !is_store_path(raw) {
		return Ok(raw.to_owned().into());
	}
	Ok(argument_template(raw).await?.into())
}

async fn argument_template(raw: &str) -> tg::Result<tg::Template> {
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
	.find_map(|prefix| raw.strip_prefix(prefix).map(|path| (prefix, path)))
	.unwrap_or(("", raw));
	let template = if matches!(prefix, "-Wl,-rpath-link," | "-Wl,-rpath,") {
		path_list_template(path).await?
	} else {
		path_template(path).await?
	};
	Ok(tg::Template::builder()
		.string(prefix)
		.components(template.components)
		.build())
}

async fn path_list_template(raw: &str) -> tg::Result<tg::Template> {
	let mut components = Vec::new();
	for (index, path) in raw.split(':').enumerate() {
		if index > 0 {
			components.push(tg::template::Component::String(":".into()));
		}
		components.extend(path_template(path).await?.components);
	}
	Ok(tg::Template::with_components(components))
}

async fn path_template(path: &str) -> tg::Result<tg::Template> {
	if !is_store_path(path) {
		return Ok(path.into());
	}
	if !Path::new(path).is_absolute() {
		return Err(tg::error!("unsupported embedded store path"));
	}
	template_from_path(path).await
}

#[cfg(test)]
mod tests {
	use super::*;

	#[tokio::test]
	async fn unsupported_embedded_environment_path_fails() {
		for raw in [
			"-DROOT=/opt/tangram/store/example/include",
			"-DROOT=/home/user/.tangram/checkouts/example/include",
			"-I\"/opt/tangram/store/example/include space\"",
		] {
			assert!(env_value("CFLAGS", raw).await.is_err());
		}
		assert!(
			env_value("CUSTOM", "prefix=/opt/tangram/store/example")
				.await
				.is_err()
		);
	}

	#[tokio::test]
	#[ignore = "requires a running Tangram server"]
	async fn environment_paths_and_flags() -> tg::Result<()> {
		tg::init()?;
		let source = tempfile::tempdir().unwrap();
		for name in ["include space", "lib"] {
			std::fs::create_dir(source.path().join(name)).unwrap();
			std::fs::write(source.path().join(name).join("example"), name).unwrap();
		}
		let root = tg::Artifact::with_referent(checkin_path(source.path()).await?.artifact);
		let path = crate::checkout_artifact(root).await?;
		let paths = format!(":/usr/bin:{0}/include space::{0}/lib:", path.display());
		let flags = format!(" -O2\t-I{0}/lib  -L {0}/lib ", path.display());
		let linker_flags = format!("-Wl,-rpath-link,{0}/lib:/usr/lib:{0}/lib", path.display());
		for (name, raw) in [
			("PATH", &paths),
			("CMAKE_PREFIX_PATH", &paths),
			("CFLAGS", &flags),
			("LDFLAGS", &linker_flags),
		] {
			let template = env_value(name, raw).await?.try_unwrap_template().unwrap();
			assert_eq!(
				crate::render_template_data(&template.to_data()).await?,
				*raw
			);
			assert_eq!(template.artifacts().count(), 2);
		}
		let argument = format!("-I{}/include space", path.display());
		let template = arg_value(&argument).await?.try_unwrap_template().unwrap();
		assert_eq!(
			crate::render_template_data(&template.to_data()).await?,
			argument
		);
		Ok(())
	}
}
