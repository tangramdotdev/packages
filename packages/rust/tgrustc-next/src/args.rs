use tangram_client::prelude::*;

/// Minimum-viable view of a rustc invocation. We carry just what the outer
/// wrapper needs to schedule a sandboxed compile and copy outputs back to
/// cargo's expected location. Everything else stays in `passthrough` as opaque
/// strings forwarded verbatim into the sandbox.
#[derive(Debug)]
pub struct Args {
	/// The rustc binary cargo passed as `argv[1]` (host path).
	pub rustc: String,
	/// The value of `--out-dir`, if cargo specified one. This is the host
	/// directory we must populate with rustc's outputs once the sandbox
	/// process finishes.
	pub out_dir: Option<String>,
	/// Every other arg, in the original order. Passed verbatim into the
	/// sandbox's argv (after the rustc binary). `--out-dir` is filtered out so
	/// the driver can inject a sandbox-local replacement.
	pub passthrough: Vec<String>,
}

impl Args {
	pub fn parse() -> tg::Result<Self> {
		let mut all = std::env::args().skip(1);
		let rustc = all
			.next()
			.ok_or_else(|| tg::error!("expected rustc binary as first argument"))?;

		let mut out_dir: Option<String> = None;
		let mut passthrough: Vec<String> = Vec::new();
		while let Some(arg) = all.next() {
			if arg == "--out-dir" {
				out_dir = all.next();
				continue;
			}
			if let Some(rest) = arg.strip_prefix("--out-dir=") {
				out_dir = Some(rest.to_owned());
				continue;
			}
			passthrough.push(arg);
		}

		Ok(Self {
			rustc,
			out_dir,
			passthrough,
		})
	}
}
