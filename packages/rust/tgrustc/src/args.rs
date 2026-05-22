use tangram_client::prelude::*;

#[derive(Debug)]
pub struct Args {
	pub rustc: String,
	pub out_dir: Option<String>,
	pub crate_name: Option<String>,
	pub extra_filename: Option<String>,
	pub passthrough: Vec<String>,
}

impl Args {
	pub fn parse() -> tg::Result<Self> {
		let mut all = std::env::args().skip(1);
		let rustc = all
			.next()
			.ok_or_else(|| tg::error!("expected rustc binary as first argument"))?;

		let mut out_dir = None;
		let mut crate_name = None;
		let mut extra_filename = None;
		let mut passthrough = Vec::new();
		while let Some(arg) = all.next() {
			if arg == "--out-dir" {
				out_dir = all.next();
				continue;
			}
			if let Some(rest) = arg.strip_prefix("--out-dir=") {
				out_dir = Some(rest.to_owned());
				continue;
			}
			if arg == "--crate-name" {
				let value = all
					.next()
					.ok_or_else(|| tg::error!("--crate-name was the last argument"))?;
				crate_name = Some(value.clone());
				passthrough.push(arg);
				passthrough.push(value);
				continue;
			}
			if let Some(rest) = arg.strip_prefix("--crate-name=") {
				crate_name = Some(rest.to_owned());
				passthrough.push(arg);
				continue;
			}
			if arg == "-C"
				&& let Some(next) = all.next()
			{
				if let Some(rest) = next.strip_prefix("extra-filename=") {
					extra_filename = Some(rest.to_owned());
				}
				passthrough.push(arg);
				passthrough.push(next);
				continue;
			}
			passthrough.push(arg);
		}

		Ok(Self {
			rustc,
			out_dir,
			crate_name,
			extra_filename,
			passthrough,
		})
	}
}
