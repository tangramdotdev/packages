use std::{
	collections::BTreeMap,
	io::Write,
	os::unix::process::CommandExt,
	path::{Path, PathBuf},
};
use tangram_client as tg;

// Data read from environment variables.
#[derive(Debug)]
struct Environment {
	// The value of TANGRAM_CC_ENABLE
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
	cli_args: Vec<String>,
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
	// -I, -include
	Include,
	// -iquote
	Quote,
	// -isystem
	System,
	// -idirafter
	DirAfter,
	// -imacro
	Macro,
	// -L
	Linker,
	// -B
	Binary,
	// Any source file input.
	Source,
}

impl Environment {
	// Parse the runtime environment.
	fn parse() -> tg::Result<Self> {
		let mut env = BTreeMap::new();
		let mut enable = false;
		for (key, value) in std::env::vars() {
			match key.as_str() {
				"TANGRAM_CC_ENABLE" => {
					enable = value.parse().map_err(|error| {
						tg::error!(source = error, "Failed to parse TANGRAM_CC_ENABLE")
					})?;
				},
				key if BLACKLISTED_ENV_VARS.contains(&key) => continue,
				_ => {
					let value = tangram_std::unrender(&value)?;
					env.insert(key, value.into());
				},
			}
		}
		let cc = which_cc()?;
		Ok(Self { enable, cc, env })
	}
}

impl Args {
	// Parse the cli arguments as if this program was gcc to extract the sources, search paths, and rest of the arguments.
	fn parse() -> tg::Result<Self> {
		let mut remap_targets = vec![];
		let mut output = None;
		let mut cli_args = vec![];
		let mut stdin = false;
		let mut iprefix = "".to_owned();

		let mut args = std::env::args().skip(1).peekable();
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
								output = Some(args.next().unwrap())
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
							})
						},
						_ => {
							if args.peek().is_some() {
								remap_targets.push(RemapTarget {
									kind: RemapKind::Binary,
									value: args.next().unwrap(),
								})
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
							})
						},
						_ => {
							if args.peek().is_some() {
								remap_targets.push(RemapTarget {
									kind: RemapKind::Include,
									value: args.next().unwrap(),
								})
							}
						},
					}
				},
				// The long form include flags are treated differently by gcc.
				"-include" => {
					if args.peek().is_some() {
						remap_targets.push(RemapTarget {
							kind: RemapKind::Include,
							value: args.next().unwrap(),
						})
					}
				},
				"-iquote" => {
					if args.peek().is_some() {
						remap_targets.push(RemapTarget {
							kind: RemapKind::Quote,
							value: args.next().unwrap(),
						})
					}
				},
				"-isystem" => {
					if args.peek().is_some() {
						remap_targets.push(RemapTarget {
							kind: RemapKind::System,
							value: args.next().unwrap(),
						})
					}
				},
				"-imacro" => {
					if args.peek().is_some() {
						remap_targets.push(RemapTarget {
							kind: RemapKind::Macro,
							value: args.next().unwrap(),
						})
					}
				},
				"-idirafter" => {
					if args.peek().is_some() {
						remap_targets.push(RemapTarget {
							kind: RemapKind::DirAfter,
							value: args.next().unwrap(),
						})
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
						})
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
						})
					}
				},
				// Extract linker search paths.
				linker_search_path if linker_search_path.starts_with("-L") => {
					match linker_search_path.strip_prefix("-L") {
						Some(directory) if !directory.is_empty() => {
							remap_targets.push(RemapTarget {
								kind: RemapKind::Linker,
								value: directory.into(),
							})
						},
						_ => {
							if args.peek().is_some() {
								remap_targets.push(RemapTarget {
									kind: RemapKind::Linker,
									value: args.next().unwrap(),
								})
							}
						},
					}
				},
				// Anything starting with a '-' is an option. Check if we need to extract its value too.
				option if option.starts_with('-') => {
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

		Ok(Self {
			stdin,
			remap_targets,
			output,
			cli_args,
		})
	}
}

fn main() {
	if let Err(e) = main_inner() {
		eprintln!("cc proxy failed: {e}");
		eprintln!(
			"{}",
			e.trace(&tg::error::TraceOptions {
				internal: true,
				reverse: false,
			})
		);
		std::process::exit(1);
	}
}

fn main_inner() -> tg::Result<()> {
	// Get the environment information (env vars, runtime, cc path).
	let environment = Environment::parse()?;

	// Get the command line arguments.
	let args = Args::parse()?;

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

	tokio::runtime::Builder::new_multi_thread()
		.enable_all()
		.build()
		.unwrap()
		.block_on(run_proxy(environment, args))?;

	Ok(())
}

async fn run_proxy(environment: Environment, args: Args) -> tg::Result<()> {
	let Args {
		output,
		remap_targets,
		cli_args,
		..
	} = args;
	let output = output.unwrap();

	// Create a client.
	let tg = &tg::Client::with_env()?;

	// Create the driver executable.
	let contents = tg::Blob::with_reader(tg, DRIVER_SH.as_bytes()).await?;
	let executable = Some(
		tg::File::with_object(tg::file::Object::Normal {
			contents,
			executable: true,
			dependencies: BTreeMap::new(),
		})
		.into(),
	);

	// Create the remapping table.
	let remappings = create_remapping_table(tg, remap_targets).await?;

	// Create the arguments to the driver script.
	let cc = tangram_std::unrender(environment.cc.to_str().unwrap())?.into();
	let mut args = std::iter::once("tangram_cc".to_string().into())
		.chain(std::iter::once(cc))
		.chain(cli_args.into_iter().map(tg::Value::from))
		.collect::<Vec<_>>();
	for (target, value) in remappings {
		match target.kind {
			RemapKind::Include => args.push("-I".to_owned().into()),
			RemapKind::Quote => args.push("-iquote".to_owned().into()),
			RemapKind::System => args.push("-isystem".to_owned().into()),
			RemapKind::DirAfter => args.push("-idirafter".to_owned().into()),
			RemapKind::Macro => args.push("-imacro".to_owned().into()),
			RemapKind::Linker => args.push("-L".to_owned().into()),
			RemapKind::Binary => args.push("-B".to_owned().into()),
			RemapKind::Source => (),
		};
		args.push(value.into())
	}

	// Create the command.
	let host = tg::host().to_string();
	let command = tg::command::Builder::new(host)
		.executable(executable)
		.args(args)
		.env(environment.env)
		.build();

	// Create a process.
	let id = command.id(tg).await?;
	let spawn_arg = tg::process::spawn::Arg {
		checksum: None,
		command: Some(id),
		create: true,
		cwd: None,
		env: None,
		network: false,
		mounts: vec![],
		parent: None,
		remote: None,
		retry: false,
		stdout: None,
		stderr: None,
		stdin: None,
	};
	let build_directory = tg::Process::run(tg, spawn_arg)
		.await?
		.try_unwrap_object()
		.map_err(|source| tg::error!(!source, "expected the build to produce an object"))?
		.try_unwrap_directory()
		.map_err(|source| tg::error!(!source, "expected the build to produce a directory"))?;

	// Dump stdout, stderr
	let stdout: Vec<u8> = build_directory
		.get(tg, &"stdout")
		.await?
		.try_unwrap_file()
		.unwrap()
		.bytes(tg)
		.await?;
	std::io::stdout()
		.write_all(&stdout)
		.map_err(|error| tg::error!(source = error, "failed to dump stdout"))?;
	let stderr: Vec<u8> = build_directory
		.get(tg, &"stderr")
		.await?
		.try_unwrap_file()
		.unwrap()
		.bytes(tg)
		.await?;
	std::io::stderr()
		.write_all(&stderr)
		.map_err(|error| tg::error!(source = error, "failed to dump stdout"))?;

	// Copy the output file to the destination.
	let output_file = build_directory
		.get(tg, &"output")
		.await
		.map_err(|error| tg::error!(source = error, "cc failed: no output"))?;

	// Verify we did everything correctly.
	let mut tangram_path = std::env::current_dir()
		.map_err(|error| tg::error!(source = error, "failed to get current working directory"))?;
	while !tangram_path.join(".tangram").exists() {
		let Some(parent) = tangram_path.parent() else {
			return Err(tg::error!("failed to find .tangram directory."));
		};
		tangram_path = parent.into();
	}
	let artifact_path = tangram_path
		.join(".tangram/artifacts")
		.join(output_file.id(tg).await?.to_string());
	eprintln!("Copying {artifact_path:#?} to {output:#?}");
	std::fs::copy(artifact_path, output)
		.map_err(|error| tg::error!(source = error, "failed to copy file"))?;

	Ok(())
}

// Find the C compiler by checking the TANGRAM_CC_CC compiler or searching PATH for cc.
fn which_cc() -> tg::Result<PathBuf> {
	let compiler_name = std::env::args().next().unwrap();
	if let Ok(cc) = std::env::var("TANGRAM_CC_COMPILER") {
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

// Represents a sparse tree of source files. Used to avoid checking in an excessive number of files for every invocation.
struct SourceTree {
	component: std::ffi::OsString,
	remap_target: Option<RemapTarget>,
	children: Option<Vec<Self>>,
}

// Convert a list of sources into a corresponding list of tg::Template.
async fn create_remapping_table(
	tg: &impl tg::Handle,
	remap_targets: Vec<RemapTarget>,
) -> tg::Result<BTreeMap<RemapTarget, tg::Template>> {
	let mut table = BTreeMap::new();
	let mut subtrees = Vec::new();

	for remap_target in remap_targets {
		// Canonicalize the source path.
		let path: &Path = remap_target.value.as_ref();
		let path = path
			.canonicalize()
			.map_err(|error| tg::error!(source = error, "failed to canonicalize path"))?;

		// Bail if the file does not exist.
		if !path.exists() {
			return Err(tg::error!("Source file does not exist: {path:#?}."));
		}

		// Check if this is a path that should be a template. Needs to happen after canonicalization in case a local symlink was created pointing to an artifact.
		if path.starts_with("/.tangram/artifacts") {
			let template = tangram_std::unrender(path.to_str().unwrap())?;
			table.insert(remap_target, template);
			continue;
		}

		// Add to the file trees.
		insert_into_source_tree(
			&mut subtrees,
			path.iter().collect::<Vec<_>>().as_slice(),
			remap_target,
		);
	}

	// Check in every source tree.
	for subtree in subtrees {
		table.extend(check_in_source_tree(tg, subtree).await?);
	}

	Ok(table)
}

fn insert_into_source_tree(
	subtrees: &mut Vec<SourceTree>,
	components: &[&std::ffi::OsStr],
	remap_target: RemapTarget,
) {
	let parent = match subtrees
		.iter_mut()
		.find(|tree| tree.component.as_os_str() == components[0])
	{
		Some(parent) => parent,
		None => {
			let parent = SourceTree {
				component: components[0].to_os_string(),
				remap_target: None,
				children: None,
			};
			subtrees.push(parent);
			subtrees.last_mut().unwrap()
		},
	};
	let components = &components[1..];
	if components.is_empty() {
		parent.remap_target = Some(remap_target);
	} else {
		if parent.children.is_none() {
			parent.children = Some(Vec::new());
		}
		let subtrees = parent.children.as_mut().unwrap();
		insert_into_source_tree(subtrees, components, remap_target);
	}
}

// Check in the source tree and return a list of templates that correspond to the files within it.
async fn check_in_source_tree(
	tg: &impl tg::Handle,
	subtree: SourceTree,
) -> tg::Result<Vec<(RemapTarget, tg::Template)>> {
	// Directory builder to check in the directory at the end.
	let mut builder = tg::directory::Builder::with_entries(BTreeMap::new());

	// List of remap targets and their subpaths within the directory that we will eventually check in.
	let mut remap_targets = Vec::new();

	// Recursively walk the subtree to collect the remap targets.
	let mut stack = vec![(vec![], subtree)];
	while let Some((mut components, subtree)) = stack.pop() {
		let SourceTree {
			component,
			remap_target,
			children,
		} = subtree;
		components.push(component);
		let is_directory = children.is_some();
		if let Some(children) = children {
			stack.extend(
				children
					.into_iter()
					.map(|child| (components.clone(), child)),
			);
		}
		if let Some(remap_target) = remap_target {
			let subpath = components[1..].iter().collect::<PathBuf>();
			let path = components.iter().collect::<PathBuf>();

			// Update the remap targets.
			remap_targets.push((remap_target, subpath.clone()));

			// Check if we're remapping a file, and check it in first.
			if !is_directory {
				let artifact = tg::Artifact::check_in(
					tg,
					tg::artifact::checkin::Arg {
						cache: false,
						destructive: false,
						deterministic: true,
						ignore: false,
						locked: false,
						lockfile: false,
						path,
					},
				)
				.await?;
				builder = builder
					.add(tg, &subpath, artifact.clone())
					.await
					.map_err(|error| {
						tg::error!(
							source = error,
							"failed to add {}, {artifact:?} to directory",
							subpath.display()
						)
					})?
			}
		}
	}

	// Create the directory from the subtree.
	let artifact: tg::Artifact = builder.build().into();

	// Get the templates for each remap target.
	let templates = remap_targets
		.into_iter()
		.map(|(remap_target, subpath)| {
			let template = tg::Template {
				components: vec![
					tg::template::Component::Artifact(artifact.clone()),
					tg::template::Component::String(format!("/{}", subpath.display())),
				],
			};
			(remap_target, template)
		})
		.collect();
	Ok(templates)
}

const DRIVER_SH: &str = include_str!("driver.sh");

// Environment variables that must be filtered out before invoking the driver target.
const BLACKLISTED_ENV_VARS: [&str; 6] = [
	"TANGRAM_ADDRESS",
	"TANGRAM_CC_TRACING",
	"TANGRAM_CC_COMPILER",
	"TANGRAM_HOST",
	"HOME",
	"OUTPUT",
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
