use tangram_client::prelude::*;

/// Input arguments to the rustc proxy.
#[derive(Debug)]
pub(crate) struct Args {
	/// Build script output directory, from `OUT_DIR`.
	pub(crate) cargo_out_directory: Option<String>,
	/// The crate being compiled, from `--crate-name`.
	pub(crate) crate_name: String,
	/// Paths from `-L dependency=` args.
	pub(crate) dependencies: Vec<String>,
	/// Extern crate entries from `--extern name=path` args.
	pub(crate) externs: Vec<(String, String)>,
	/// All other rustc arguments not handled above.
	pub(crate) remaining: Vec<String>,
	/// Path to the real rustc binary.
	pub(crate) rustc: String,
	/// Output directory from `--out-dir`. Always provided by cargo for builds that reach `run_proxy`.
	pub(crate) rustc_output_directory: Option<String>,
	/// The crate's manifest directory, from `CARGO_MANIFEST_DIR` or inferred from source file paths.
	pub(crate) source_directory: String,
	/// Whether cargo is piping source via stdin.
	pub(crate) stdin: bool,
}

impl Args {
	pub(crate) fn parse() -> tg::Result<Self> {
		let rustc = std::env::args()
			.nth(1)
			.ok_or(tg::error!("missing argument for rustc"))?;
		let mut stdin = false;
		let mut crate_name = None;
		let mut dependencies = Vec::new();
		let mut externs = Vec::new();
		let mut rustc_output_directory = None;
		let mut remaining = Vec::new();
		let cargo_out_directory = std::env::var("OUT_DIR").ok();

		let mut arg_iter = std::env::args().skip(2).peekable();
		while let Some(arg) = arg_iter.next() {
			let value = if ARGS_WITH_VALUES.contains(&arg.as_str())
				&& arg_iter.peek().is_some_and(|a| !a.starts_with('-'))
			{
				arg_iter.next()
			} else {
				None
			};
			match (arg.as_ref(), value) {
				("--crate-name", Some(name)) => {
					crate_name = Some(name.clone());
					remaining.push(arg);
					remaining.push(name);
				},
				("-L", Some(value)) if value.starts_with("dependency=") => {
					dependencies.push(value.strip_prefix("dependency=").unwrap().into());
				},
				("--extern", Some(value)) => {
					let (name, path) = match value.split_once('=') {
						Some((n, p)) => (n, p),
						None => (value.as_str(), ""),
					};
					externs.push((name.into(), path.into()));
				},
				("--out-dir", Some(value)) => rustc_output_directory = Some(value),
				(arg, None) if arg.starts_with("--out-dir=") => {
					rustc_output_directory = arg.strip_prefix("--out-dir=").map(Into::into);
				},
				("-", None) => {
					stdin = true;
					remaining.push("-".into());
				},
				(_, None) => remaining.push(arg),
				(_, Some(value)) => {
					remaining.push(arg);
					remaining.push(value);
				},
			}
		}

		// Determine source directory from CARGO_MANIFEST_DIR or .rs file path.
		let source_directory = std::env::var("CARGO_MANIFEST_DIR").ok().unwrap_or_else(|| {
			remaining
				.iter()
				.find(|arg| {
					std::path::Path::new(arg)
						.extension()
						.is_some_and(|ext| ext.eq_ignore_ascii_case("rs"))
				})
				.and_then(|arg| {
					std::path::Path::new(arg)
						.parent()
						.and_then(|p| p.to_str())
						.map(ToOwned::to_owned)
				})
				.unwrap_or_else(|| ".".into())
		});

		Ok(Self {
			cargo_out_directory,
			crate_name: crate_name.unwrap_or_else(|| "unknown".into()),
			dependencies,
			externs,
			remaining,
			rustc,
			rustc_output_directory,
			source_directory,
			stdin,
		})
	}
}

// List of rustc args that take a value.
const ARGS_WITH_VALUES: [&str; 31] = [
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
	"--remap-path-prefix",
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
