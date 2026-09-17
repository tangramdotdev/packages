use std::{
	collections::BTreeMap,
	io::Write,
	os::unix::process::CommandExt,
	path::{Path, PathBuf},
};
use tangram_client::prelude::*;

// Data read from environment variables.
#[derive(Debug)]
struct Environment {
	// The value of TGCC_ENABLE
	enable: bool,

	// The path to the C compiler.
	cc: PathBuf,

	// The rest of the environment variables, stripped and converted for a tg::target::Object.
	env: BTreeMap<String, tg::Value>,
}

// Command line arguments intercepted before creating a target.
#[derive(Debug)]
struct Args {
	// Whether the compiler needs to read from stdin.
	stdin: bool,

	// The output file, if it exists.
	output: Option<String>,

	// Arguments that need to be remapped, eg sources, includes, link libraries, isystem, imacro, -B, etc.
	remap_targets: Vec<RemapTarget>,

	// The rest of the CLI invocation.
	cli: Vec<String>,
}

// Any arguments that need to be remapped to templates.
#[derive(Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
struct RemapTarget {
	kind: RemapKind,
	value: String,
}

// https://gcc.gnu.org/onlinedocs/gcc/Directory-Options.html
#[derive(Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
enum RemapKind {
	// -I
	Include,
	// -idirafter
	DirAfter,
	// -L
	Linker,
	// -B
	Binary,
	// Other compiler options whose operand is a path.
	Option(&'static str),
	// Any source file input.
	Source,
}

impl Environment {
	// Parse the runtime environment.
	fn parse() -> tg::Result<Self> {
		let mut env = BTreeMap::new();
		let enable = std::env::var_os("TGCC_ENABLE")
			.map(|value| proxy::options::boolean(&value, "TGCC_ENABLE"))
			.transpose()?
			.unwrap_or(false);
		for (key, value) in std::env::vars() {
			match key.as_str() {
				"TGCC_ENABLE" => {},
				key if BLACKLISTED_ENV_VARS.contains(&key)
					|| key.starts_with(tg::process::env::PREFIX) => {},
				_ => {
					env.insert(key, value.into());
				},
			}
		}
		let cc = which_cc()?;
		Ok(Self { enable, cc, env })
	}
	async fn checkin(&mut self) -> tg::Result<()> {
		for (name, value) in &mut self.env {
			let tg::Value::String(raw) = value else {
				continue;
			};
			*value = proxy::environment_value(name, raw, async |path| {
				common::template_from_path(path).await
			})
			.await?;
		}
		Ok(())
	}
}

impl Args {
	// Parse the cli arguments as if this program was gcc to extract the sources, search paths, and rest of the arguments.
	#[allow(clippy::too_many_lines)]
	fn parse(args: impl Iterator<Item = String>) -> Self {
		let mut remap_targets = vec![];
		let mut output = None;
		let mut cli_args = vec![];
		let mut stdin = false;
		let mut iprefix = String::new();

		let mut args = args.peekable();
		while let Some(arg) = args.next() {
			match arg.as_str() {
				// By convention, '-' refers to using stdin as the source file.
				"-" => {
					stdin = true;
				},
				// Extract the output path.
				output_path if output_path.starts_with("-o") => {
					match output_path.strip_prefix("-o") {
						Some(path) if !path.is_empty() => {
							output = Some(path.into());
						},
						_ => {
							if args.peek().is_some() {
								output = Some(args.next().unwrap());
							}
						},
					}
				},
				// Extract any -B paths.
				binary_path if binary_path.starts_with("-B") => {
					match binary_path.strip_prefix("-B") {
						Some(directory) if !directory.is_empty() => {
							remap_targets.push(RemapTarget {
								kind: RemapKind::Binary,
								value: directory.into(),
							});
						},
						_ => {
							if args.peek().is_some() {
								remap_targets.push(RemapTarget {
									kind: RemapKind::Binary,
									value: args.next().unwrap(),
								});
							}
						},
					}
				},
				// Extract any include paths with -I.
				include_path if include_path.starts_with("-I") => {
					match include_path.strip_prefix("-I") {
						Some(directory) if !directory.is_empty() => {
							remap_targets.push(RemapTarget {
								kind: RemapKind::Include,
								value: directory.into(),
							});
						},
						_ => {
							if args.peek().is_some() {
								remap_targets.push(RemapTarget {
									kind: RemapKind::Include,
									value: args.next().unwrap(),
								});
							}
						},
					}
				},
				// Handle prefixes. This is a stateful operation over the command line arguments, where subsequent -iprefix arguments will override any previous -iprefix.
				"-iprefix" => {
					if args.peek().is_some() {
						iprefix = args.next().unwrap();
					}
				},
				// Add the argument to the include search paths after joining with the current prefix.
				"-iwithprefix" => {
					if args.peek().is_some() {
						let subpath = args.next().unwrap();
						let path = format!("{iprefix}{subpath}");
						remap_targets.push(RemapTarget {
							kind: RemapKind::Include,
							value: path,
						});
					}
				},
				// Add the argument to the idirafter search paths after joining with the current prefix.
				"-iwithprefixbefore" => {
					if args.peek().is_some() {
						let subpath = args.next().unwrap();
						let path = format!("{iprefix}{subpath}");
						remap_targets.push(RemapTarget {
							kind: RemapKind::DirAfter,
							value: path,
						});
					}
				},
				// Extract linker search paths.
				linker_search_path if linker_search_path.starts_with("-L") => {
					match linker_search_path.strip_prefix("-L") {
						Some(directory) if !directory.is_empty() => {
							remap_targets.push(RemapTarget {
								kind: RemapKind::Linker,
								value: directory.into(),
							});
						},
						_ => {
							if args.peek().is_some() {
								remap_targets.push(RemapTarget {
									kind: RemapKind::Linker,
									value: args.next().unwrap(),
								});
							}
						},
					}
				},
				// Anything starting with a '-' is an option. Check if we need to extract its value too.
				option if option.starts_with('-') => {
					if let Some((prefix, flag)) = [
						("--sysroot=", "--sysroot"),
						("--sysroot", "--sysroot"),
						("-isysroot", "-isysroot"),
						("-isystem", "-isystem"),
						("-iquote", "-iquote"),
						("-idirafter", "-idirafter"),
						("-include-pch", "-include-pch"),
						("-include", "-include"),
						("-imacros", "-imacros"),
					]
					.into_iter()
					.find(|(prefix, _)| {
						option == *prefix
							|| (*prefix != "-include-pch" && option.starts_with(prefix))
					}) {
						let path = option.strip_prefix(prefix).unwrap();
						let path = if path.is_empty() {
							args.next().unwrap_or_default()
						} else {
							path.to_owned()
						};
						remap_targets.push(RemapTarget {
							kind: RemapKind::Option(flag),
							value: path,
						});
						continue;
					}
					cli_args.push(option.into());
					if let Some(opt) = CC_OPTIONS_WITH_VALUE
						.iter()
						.find(|opt| option.starts_with(*opt))
					{
						let value = option.strip_prefix(opt).unwrap();
						if value.is_empty() && args.peek().is_some() {
							cli_args.push(args.next().unwrap());
						}
					}
				},
				_ => {
					remap_targets.push(RemapTarget {
						kind: RemapKind::Source,
						value: arg,
					});
				},
			}
		}

		Self {
			stdin,
			remap_targets,
			output,
			cli: cli_args,
		}
	}
}

fn main() {
	if let Err(e) = main_inner() {
		common::error::print_error(e);
		std::process::exit(1);
	}
}

fn main_inner() -> tg::Result<()> {
	// Get the environment information (env vars, runtime, cc path).
	let environment = Environment::parse()?;

	// Get the command line arguments.
	let args = Args::parse(std::env::args().skip(1));

	// If this invocation isn't being used to generate output or needs to read from stdin, fallback on the detected C compiler.
	if !environment.enable || args.output.is_none() || args.stdin {
		let error = std::process::Command::new(&environment.cc)
			.args(std::env::args_os().skip(1))
			.exec();

		return Err(tg::error!(
			"failed to invoke C compiler ({:#?}): {error}",
			environment.cc
		));
	}

	tg::init()?;

	tokio::runtime::Builder::new_current_thread()
		.enable_all()
		.build()
		.unwrap()
		.block_on(run_proxy(environment, args))?;

	Ok(())
}

async fn linker_argument(
	raw: &str,
	mut template_from_path: impl AsyncFnMut(&str) -> tg::Result<tg::Template>,
) -> tg::Result<tg::Template> {
	let Some(args) = raw.strip_prefix("-Wl,") else {
		return Ok(raw.into());
	};
	let mut args = args.split(',');
	let mut template = tg::Template::builder().string("-Wl");
	while let Some(arg) = args.next() {
		template = template.string(",");
		let (option, path) = arg
			.split_once('=')
			.map_or((arg, None), |(option, path)| (option, Some(path)));
		if !matches!(option, "-rpath" | "-rpath-link" | "-dynamic-linker") {
			template = template.string(arg);
			continue;
		}
		template = template.string(option);
		let paths = if let Some(path) = path {
			template = template.string("=");
			path
		} else if let Some(path) = args.next() {
			template = template.string(",");
			path
		} else {
			break;
		};
		if option == "-rpath" {
			// Runtime paths need not exist at build time. Only recover Tangram references.
			template = template.components(
				proxy::template_from_string(paths, &mut template_from_path)
					.await?
					.components,
			);
			continue;
		}
		for (index, path) in paths
			.split(|c| option == "-rpath-link" && c == ':')
			.enumerate()
		{
			if index > 0 {
				template = template.string(":");
			}
			let should_check_in = !path.is_empty()
				&& !path.starts_with('@')
				&& (option == "-dynamic-linker" || !path.contains('$'));
			template = if should_check_in {
				template.components(template_from_path(path).await?.components)
			} else {
				template.string(path)
			};
		}
	}
	Ok(template.build())
}

#[allow(clippy::too_many_lines)]
async fn run_proxy(mut environment: Environment, args: Args) -> tg::Result<()> {
	environment.checkin().await?;
	let Args {
		output,
		remap_targets,
		cli: cli_args,
		..
	} = args;
	let output = output.unwrap();
	// Include/library/source operands were separated by Args::parse above.
	// Remaining path-bearing options here are forwarded directly to the linker.
	let mut forwarded = Vec::with_capacity(cli_args.len());
	for arg in cli_args {
		let template =
			linker_argument(&arg, async |path| common::template_from_path(path).await).await?;
		forwarded.push(template.into());
	}

	// Create the driver executable.
	let contents = tg::Blob::with_reader(DRIVER_SH.as_bytes()).await?;
	let executable = tg::File::with_object(tg::file::Object::Node(tg::file::object::Node {
		contents,
		executable: true,
		dependencies: BTreeMap::new(),
		module: None,
	}));

	// Create the remapping table.
	let remappings = create_remapping_table(remap_targets).await?;

	// Create the arguments to the driver script.
	let cc = common::template_from_path(&environment.cc).await?.into();
	let mut args = std::iter::once(cc).chain(forwarded).collect::<Vec<_>>();
	for (target, value) in remappings {
		match target.kind {
			RemapKind::Include => args.push("-I".to_owned().into()),
			RemapKind::DirAfter => args.push("-idirafter".to_owned().into()),
			RemapKind::Linker => args.push("-L".to_owned().into()),
			RemapKind::Binary => args.push("-B".to_owned().into()),
			RemapKind::Option(flag) => args.push(flag.to_owned().into()),
			RemapKind::Source => (),
		}
		args.push(value.into());
	}

	let host = tg::host::current().to_owned();
	let arg = tg::process::Arg {
		args,
		env: environment.env,
		executable: Some(executable.into()),
		host: Some(host),
		name: Some("cc".into()),
		sandbox: Some(tg::process::SandboxArg::Bool(true)),
		..Default::default()
	};

	let process: tg::Process =
		tg::Process::spawn(arg, tg::process::spawn::Options::default()).await?;
	let wait = process.wait(tg::process::wait::Options::default()).await?;

	let build_directory = wait
		.output
		.ok_or_else(|| tg::error!("expected the build to produce output"))?
		.try_unwrap_object()
		.map_err(|error| tg::error!(!error, "expected the build to produce an object"))?
		.try_unwrap_directory()
		.map_err(|error| tg::error!(!error, "expected the build to produce a directory"))?;

	// Dump stdout, stderr
	let stdout: Vec<u8> = build_directory
		.get(&"stdout")
		.await?
		.try_unwrap_file()
		.unwrap()
		.bytes()
		.await?;
	std::io::stdout()
		.write_all(&stdout)
		.map_err(|error| tg::error!(source = error, "failed to dump stdout"))?;
	let stderr: Vec<u8> = build_directory
		.get(&"stderr")
		.await?
		.try_unwrap_file()
		.unwrap()
		.bytes()
		.await?;
	std::io::stderr()
		.write_all(&stderr)
		.map_err(|error| tg::error!(source = error, "failed to dump stdout"))?;

	// Copy the output file to the destination.
	let output_file = build_directory
		.get(&"output")
		.await
		.map_err(|error| tg::error!(source = error, "cc failed: no output"))?;

	let artifact_path = common::checkout_artifact(output_file).await?;
	eprintln!("Copying {} to {output:#?}", artifact_path.display());
	std::fs::copy(artifact_path, output)
		.map_err(|error| tg::error!(source = error, "failed to copy file"))?;

	Ok(())
}

// Find the C compiler by checking the TGCC_COMPILER compiler or searching PATH for cc.
fn which_cc() -> tg::Result<PathBuf> {
	let compiler_name = std::env::args().next().unwrap();
	if let Ok(cc) = std::env::var("TGCC_COMPILER") {
		return Ok(cc.into());
	}
	let path =
		std::env::var("PATH").map_err(|error| tg::error!(source = error, "PATH is not set"))?;
	let cc = path
		.split(':')
		.filter_map(|path| {
			let path: &Path = path.as_ref();
			let path = path.join(&compiler_name);
			path.exists().then_some(path)
		})
		.nth(1)
		.ok_or(tg::error!("could not find cc"))?;
	Ok(cc)
}

// Check in each input before using its returned context or assembling local file layout.
async fn create_remapping_table(
	remap_targets: Vec<RemapTarget>,
) -> tg::Result<Vec<(RemapTarget, tg::Template)>> {
	let mut table = Vec::with_capacity(remap_targets.len());
	let mut files = BTreeMap::<PathBuf, tg::Artifact>::new();
	let mut local_targets = Vec::new();
	for target in remap_targets {
		let path = std::path::absolute(&target.value)
			.map_err(|error| tg::error!(!error, "invalid input path"))?;
		let mut arg = tg::checkin::Arg {
			options: tg::checkin::Options {
				destructive: false,
				deterministic: true,
				ignore: false,
				source_dependencies: true,
				locked: false,
				lock: None,
				root: true,
				..Default::default()
			},
			path: path.clone(),
			updates: vec![],
		};
		let mut output = tg::checkin(arg.clone()).await?;
		if matches!(output.artifact.node, tg::artifact::Id::Symlink(_)) {
			// A standalone filesystem symlink does not include its target.
			arg.path = path
				.canonicalize()
				.map_err(|error| tg::error!(!error, "failed to resolve input symlink"))?;
			output = tg::checkin(arg).await?;
		}
		if output.artifact.options.id.is_some()
			|| matches!(output.artifact.node, tg::artifact::Id::Directory(_))
		{
			let template = proxy::template_from_referent(&output.artifact)?;
			table.push((target, template));
			continue;
		}
		// Preserve filenames and relative layout for files without a containing root.
		let path = path
			.parent()
			.unwrap()
			.canonicalize()
			.map_err(|error| tg::error!(!error, "failed to canonicalize input parent"))?
			.join(
				path.file_name()
					.ok_or_else(|| tg::error!("expected an input filename"))?,
			);
		let subpath = path.strip_prefix("/").unwrap().to_owned();
		let artifact = tg::Artifact::with_referent(output.artifact);
		files.insert(subpath.clone(), artifact);
		local_targets.push((table.len(), subpath));
		// Filled once the selected files have been assembled into their common root.
		table.push((target, tg::Template::from("")));
	}
	if !files.is_empty() {
		let mut builder = tg::directory::Builder::with_entries(BTreeMap::new());
		for (path, artifact) in files {
			builder = builder.add(&path, artifact).await?;
		}
		let root: tg::Artifact = builder.build().into();
		for (index, path) in local_targets {
			table[index].1 = common::template_from_artifact_and_subpath(root.clone(), path);
		}
	}
	Ok(table)
}

const DRIVER_SH: &str = include_str!("driver.sh");

// Environment variables that must be filtered out before invoking the driver target.
const BLACKLISTED_ENV_VARS: [&str; 6] = [
	"TANGRAM_ADDRESS",
	"TGCC_TRACING",
	"TGCC_COMPILER",
	"HOME",
	"OUTPUT",
	"TMPDIR",
];

// List of gcc options that take a value. This list **must** be comprehensive.
// https://gcc.gnu.org/onlinedocs/gcc/Option-Summary.html
const CC_OPTIONS_WITH_VALUE: [&str; 18] = [
	"--param",
	"-A",
	"-aux-info",
	"-D",
	"-dumpbase-ext",
	"-dumpbase",
	"-dumpdir",
	"-e",
	"-g",
	"-l",
	"-T",
	"-u",
	"-U",
	"-wrapper",
	"-x",
	"-Xlinker",
	"-Xpreprocessor",
	"-z",
];

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn path_options_preserve_their_meaning() {
		for (flag, path) in [
			("-include-pch", "header.pch"),
			("-include", "/include"),
			("-include", "-pch.h"),
			("-imacros", "/include"),
			("-isystem", "/include"),
			("-iquote", "/include"),
			("-idirafter", "/include"),
			("--sysroot", "/include"),
		] {
			let separator = if flag == "--sysroot" { "=" } else { "" };
			for mut cli in [
				vec![flag.to_owned(), path.to_owned()],
				vec![format!("{flag}{separator}{path}")],
			] {
				// Clang accepts -include-pch with a separate operand.
				if flag == "-include-pch" && cli.len() == 1 {
					continue;
				}
				cli.extend(["main.c".to_owned(), "-o".to_owned(), "main".to_owned()]);
				let args = Args::parse(cli.into_iter());
				assert_eq!(
					args.remap_targets,
					vec![
						RemapTarget {
							kind: RemapKind::Option(flag),
							value: path.into(),
						},
						RemapTarget {
							kind: RemapKind::Source,
							value: "main.c".into(),
						},
					]
				);
				assert!(args.cli.is_empty());
				assert_eq!(args.output.as_deref(), Some("main"));
			}
		}
	}

	#[tokio::test]
	async fn runtime_paths_stay_literal() {
		for raw in [
			"-Wl,-rpath,/future/install/lib,-z,now",
			"-Wl,-rpath,/tmp:./lib::$ORIGIN/../lib:@loader_path:",
			"-Wl,-z,now,-rpath=/future/install/lib",
			"-Wl,-rpath,",
			"-Wl,-rpath",
			"-Wl,--as-needed,,",
			"-pthread",
		] {
			let template = linker_argument(raw, async |_| panic!("unexpected checkin"))
				.await
				.unwrap();
			assert_eq!(render(&template), raw);
		}
	}

	#[tokio::test]
	async fn runtime_paths_recover_embedded_references() {
		let directory = tg::Directory::with_id(tg::directory::Id::new(b"runtime libraries"));
		let root = format!("/opt/tangram/store/{}", directory.id());
		let raw = format!("-Wl,-rpath,/future/lib:{root}/lib:$ORIGIN,-z,now");
		let mut calls = Vec::new();
		let template = linker_argument(&raw, async |path| {
			calls.push(path.to_owned());
			Ok(tg::Template::builder().artifact(directory.clone()).build())
		})
		.await
		.unwrap();
		assert_eq!(calls, [root]);
		assert_eq!(template.artifacts().count(), 1);
		assert_eq!(
			render(&template),
			"-Wl,-rpath,/future/lib:/checked-in/lib:$ORIGIN,-z,now"
		);
	}

	#[tokio::test]
	async fn linker_paths_preserve_comma_separated_options() {
		for (raw, paths, expected) in [
			(
				"-Wl,-rpath-link,/one:/two,-z,now",
				vec!["/one", "/two"],
				"-Wl,-rpath-link,/checked-in:/checked-in,-z,now",
			),
			(
				"-Wl,-dynamic-linker=/loader,-z,now",
				vec!["/loader"],
				"-Wl,-dynamic-linker=/checked-in,-z,now",
			),
			(
				"-Wl,-z,now,-rpath-link=/lib,-rpath,/future/lib,-dynamic-linker,/loader,-z,relro",
				vec!["/lib", "/loader"],
				"-Wl,-z,now,-rpath-link=/checked-in,-rpath,/future/lib,-dynamic-linker,/checked-in,-z,relro",
			),
			(
				"-Wl,-rpath-link,:./local::$ORIGIN:@loader_path:,-z,now",
				vec!["./local"],
				"-Wl,-rpath-link,:/checked-in::$ORIGIN:@loader_path:,-z,now",
			),
		] {
			let directory = tg::Directory::with_id(tg::directory::Id::new(b"linker input"));
			let mut calls = Vec::new();
			let template = linker_argument(raw, async |path| {
				calls.push(path.to_owned());
				Ok(tg::Template::builder().artifact(directory.clone()).build())
			})
			.await
			.unwrap();
			assert_eq!(calls, paths, "{raw}");
			assert_eq!(template.artifacts().count(), paths.len());
			assert_eq!(render(&template), expected, "{raw}");
		}
	}

	fn render(template: &tg::Template) -> String {
		template
			.try_render_sync(|component| match component {
				tg::template::Component::String(string) => Ok(string.as_str().into()),
				tg::template::Component::Artifact(_) => Ok("/checked-in".into()),
				tg::template::Component::Placeholder(_) => panic!("unexpected placeholder"),
			})
			.unwrap()
	}
}
