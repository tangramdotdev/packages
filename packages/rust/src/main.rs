use itertools::Itertools;
use std::{collections::BTreeMap, os::unix::process::CommandExt, path::PathBuf};
use tangram_client as tg;
use tokio::io::AsyncWriteExt;

// Input arguments to the rustc proxy.
#[derive(Debug)]
struct Args {
    // The argument used for rustc.
    rustc: String,

    // Whether the caller expects to pipe stdin into this proxy.
    stdin: bool,

    // Any -L dependency=PATH arguments.
    dependencies: Vec<String>,

    // Any --extern NAME=PATH arguments.
    externs: Vec<(String, String)>,

    // The --out-dir PATH if it exists.
    rustc_output_directory: Option<String>,

    // The rest of the arguments passed to rustc.
    rustc_args: Vec<String>,

    // The the value of CARGO_MANIFEST_DIRECTORY set by cargo.
    cargo_manifest_directory: String,

    // The value of OUT_DIR set by cargo.
    cargo_out_directory: Option<String>,

    // The location of the nearest .tangram directory.
    tangram_path: PathBuf,
}

impl Args {
    // Parse the command line arguments passed to the proxy by cargo.
    fn parse() -> tg::Result<Self> {
        // Parse arguments.
        let rustc = std::env::args()
            .nth(1)
            .ok_or(tg::error!("missing argument for rustc"))?;
        let mut stdin = false;
        let mut dependencies = Vec::new();
        let mut externs = Vec::new();
        let mut rustc_output_directory = None;
        let mut rustc_args = Vec::new();

        // TODO: sort the arguments into a canonical order to maximize cache hits.
        let mut args = std::env::args().skip(2).peekable();
        while let Some(arg) = args.next() {
            let value = if ARGS_WITH_VALUES.contains(&arg.as_str())
                && args
                    .peek()
                    .map(|arg| !arg.starts_with('-'))
                    .unwrap_or(false)
            {
                args.next()
            } else {
                None
            };
            match (arg.as_ref(), value) {
                ("-L", Some(value)) if value.starts_with("dependency=") => {
                    let dependency = value.strip_prefix("dependency=").unwrap().into();
                    dependencies.push(dependency);
                }
                ("--extern", Some(value)) => {
                    let components = value.split('=').collect_vec();
                    let (name, path) = if components.len() == 1 {
                        (components[0], "")
                    } else if components.len() == 2 {
                        (components[0], components[1])
                    } else {
                        return Err(tg::error!("invalid --extern argument: {value}"));
                    };
                    externs.push((name.into(), path.into()));
                }
                ("--out-dir", Some(value)) => {
                    rustc_output_directory = Some(value);
                }
                ("-", None) => {
                    stdin = true;
                    rustc_args.push("-".into());
                }
                (_, None) => {
                    rustc_args.push(arg);
                }
                (_, Some(value)) => {
                    rustc_args.push(arg);
                    rustc_args.push(value);
                }
            }
        }

        // Read environment variables set by cargo. CARGO_MANIFEST_DIR isn't guaranteed to be set by cargo, but we don't need to care about that case.
        let cargo_manifest_directory = std::env::var("CARGO_MANIFEST_DIR").unwrap_or(".".into());
        let cargo_out_directory = std::env::var("OUT_DIR").ok();

        // Find the tangram path.
        let cwd = std::env::current_dir()
            .map_err(|error| tg::error!(source = error, "missing current dir"))?;

        // Get the tangram root path by walking up from the current directory.
        let mut search_dir = cwd.clone();
        while !search_dir.join(".tangram").exists() {
            let Some(parent) = search_dir.parent() else {
                return Err(tg::error!("missing tangram path"));
            };
            search_dir = parent.into();
        }
        let tangram_path = search_dir.join(".tangram");

        Ok(Self {
            rustc,
            stdin,
            dependencies,
            externs,
            rustc_output_directory,
            cargo_manifest_directory,
            cargo_out_directory,
            rustc_args,
            tangram_path,
        })
    }
}

#[tokio::main]
async fn main() {
    if let Err(e) = main_inner().await {
        eprintln!("rustc proxy failed: {e}");
        eprintln!("{}", e.trace(&tg::error::TraceOptions::default()));
        std::process::exit(1);
    }
}

async fn main_inner() -> tg::Result<()> {
    let args = Args::parse()?;

    // If cargo expects to pipe into stdin, we immediately invoke rustc without doing anything.
    if args.stdin {
        let error = std::process::Command::new(std::env::args().nth(1).unwrap())
            .args(std::env::args().skip(2))
            .exec();
        return Err(tg::error!("exec failed: {error}."));
    }

    // Create a client.
    let tg = tg::Client::with_env()?;
    let tg = &tg;

    // Check in the source and output directories.
    let source_directory =
        tg::Artifact::check_in(tg, args.cargo_manifest_directory.parse().unwrap()).await?;
    let out_dir = if let Some(path) = &args.cargo_out_directory {
        tg::Artifact::check_in(tg, path.parse().unwrap()).await?
    } else {
        tg::Directory::new(BTreeMap::new()).into()
    };

    // Create the executable file.
    let contents = tg::Blob::with_reader(tg, DRIVER_SH, None).await?;
    let executable = true;
    let references = Vec::new();
    let object = tg::file::Object {
        contents,
        executable,
        references,
    };
    let executable = tg::File::with_object(object).into();

    // Unrender the environment.
    let mut env = BTreeMap::new();
    for (name, value) in
        std::env::vars().filter(|(name, _)| !BLACKLISTED_ENV_VARS.contains(&name.as_str()))
    {
        let value = tg::Template::unrender(&value)?;
        env.insert(name, value.into());
    }

    // Create/Unrender the arguments passed to driver.sh.
    let rustc = tg::Template::unrender(&args.rustc)?;
    let mut target_args: Vec<tg::Value> = vec![
        "--rustc".to_owned().into(),
        rustc.into(),
        "--source".to_owned().into(),
        source_directory.into(),
        "--out-dir".to_owned().into(),
        out_dir.into(),
        "--".to_owned().into(),
    ];

    for arg in &args.rustc_args {
        let template = tg::Template::unrender(arg)?;
        target_args.push(template.into());
    }

    // Check in any -L dependency=PATH directories, and splice any matching --extern name=PATH args.
    for dependency in &args.dependencies {
        let directory = tg::Artifact::check_in(tg, dependency.parse().unwrap()).await?;
        let template = tg::Template {
            components: vec!["dependency=".to_owned().into(), directory.clone().into()],
        };
        target_args.extend(["-L".to_owned().into(), template.into()]);
        let externs = args
            .externs
            .iter()
            .filter_map(|(name, path)| {
                let template = if path.is_empty() {
                    tg::Template {
                        components: vec![name.to_string().into()],
                    }
                } else {
                    let subpath = path.strip_prefix(dependency)?;
                    tg::Template {
                        components: vec![
                            format!("{name}=").into(),
                            directory.clone().into(),
                            subpath.to_owned().into(),
                        ],
                    }
                };
                Some(["--extern".to_owned().into(), template.into()])
            })
            .flatten();
        target_args.extend(externs);
    }

    // Create the target.
    let host = host().to_string();
    let lock = None;
    let checksum = None;
    let name = Some("tangram_rustc".into());
    let object = tg::target::Object {
        executable,
        env,
        host,
        lock,
        args: target_args,
        name,
        checksum,
    };
    let target = tg::Target::with_object(object);
    let target_id = target.id(tg, None).await?;

    // Create the build and mark it as a child.
    let build_options = tg::build::GetOrCreateArg {
        parent: None,
        remote: false,
        retry: tg::build::Retry::Failed,
        target: target_id.clone(),
    };
    let tg::build::GetOrCreateOutput { id: build_id } =
        tg.get_or_create_build(build_options).await?;

    // Get the build outcome.
    let outcome = tg::Build::with_id(build_id)
        .outcome(tg)
        .await
        .map_err(|error| tg::error!(source = error, "failed to get the build"))?;

    // Get the output.
    let output = match outcome {
        tg::build::Outcome::Canceled => return Err(tg::error!("Build was cancelled.")),
        tg::build::Outcome::Failed(error) => return Err(tg::error!("Build failed: {error}")),
        tg::build::Outcome::Succeeded(success) => success
            .try_unwrap_object()
            .map_err(|error| {
                tg::error!(source = error, "expected the build outcome to be an object")
            })?
            .try_unwrap_directory()
            .map_err(|error| {
                tg::error!(
                    source = error,
                    "expected the build output to be a directory"
                )
            })?,
    };

    // Get stdout/stderr from the build and forward it to our stdout/stderr.
    let stdout = output
        .get(tg, &"log/stdout".parse().unwrap())
        .await?
        .try_unwrap_file()
        .unwrap()
        .contents(tg)
        .await?
        .bytes(tg)
        .await?;
    tokio::io::stdout()
        .write_all(&stdout)
        .await
        .map_err(|error| tg::error!(source = error, "failed to write stderr"))?;
    let stderr = output
        .get(tg, &"log/stderr".parse().unwrap())
        .await?
        .try_unwrap_file()
        .unwrap()
        .contents(tg)
        .await?
        .bytes(tg)
        .await?;
    tokio::io::stderr()
        .write_all(&stderr)
        .await
        .map_err(|error| tg::error!(source = error, "failed to write stderr"))?;

    // Get the output directory.
    let output_directory = args
        .tangram_path
        .join("artifacts")
        .join(output.id(tg, None).await?.to_string())
        .join("build");

    // Copy output files from $OUTPUT to the path specified.
    for from in output_directory.read_dir().unwrap() {
        let filename = from.unwrap().file_name().into_string().unwrap();
        let from = output_directory.join(&filename);
        let to = PathBuf::from(args.rustc_output_directory.as_ref().unwrap()).join(filename);
        if from.exists() && from.is_file() {
            tokio::fs::copy(from, to)
                .await
                .map_err(|error| tg::error!(source = error, "failed to copy output directory"))?;
        }
    }
    Ok(())
}

fn host() -> &'static str {
    #[cfg(all(target_arch = "aarch64", target_os = "macos"))]
    {
        "aarch64-darwin"
    }
    #[cfg(all(target_arch = "aarch64", target_os = "linux"))]
    {
        "aarch64-linux"
    }
    #[cfg(all(target_arch = "x86_64", target_os = "macos"))]
    {
        "x86_64-darwin"
    }
    #[cfg(all(target_arch = "x86_64", target_os = "linux"))]
    {
        "x86_64-linux"
    }
}

// The driver script.
const DRIVER_SH: &[u8] = include_bytes!("driver.sh");

// List of rustc args that take a value.
const ARGS_WITH_VALUES: [&str; 32] = [
    "--allow",
    "--cap-lints",
    "--cfg",
    "--codegen",
    "--color",
    "--crate-name",
    "--crate-type",
    "--deny",
    "--diagnostic-width",
    "--edition",
    "--emit",
    "--error-format",
    "--explain",
    "--extern",
    "--forbid",
    "--force-warn",
    "--json",
    "--out-dir",
    "--print",
    "--print",
    "--remap-path-refix",
    "--sysroot",
    "--target",
    "--warn",
    "-A",
    "-C",
    "-D",
    "-F",
    "-l",
    "-L",
    "-o",
    "-W",
];

// Environment variables that must be filtered out before invoking the driver target.
const BLACKLISTED_ENV_VARS: [&str; 5] = [
    "TANGRAM_RUSTC_TRACING",
    "TANGRAM_HOST",
    "TANGRAM_URL",
    "HOME",
    "OUTPUT",
];
