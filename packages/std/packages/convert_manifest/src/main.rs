use std::io::{Read, Write};

use tangram_std::Manifest;

#[derive(clap::Parser)]
struct Args {
	#[arg(short, long)]
	output: Output,
}

#[derive(clap::ValueEnum, Copy, Clone)]
enum Output {
	Bin,
	Json,
}

fn main() -> std::io::Result<()> {
	let args = <Args as clap::Parser>::parse();
	let mut input = Vec::new();
	std::io::stdin().read_to_end(&mut input)?;

	let manifest: Manifest = if input.starts_with(b"{") {
		serde_json::from_slice(&input).map_err(|error| std::io::Error::other(error.to_string()))?
	} else {
		tangram_serialize::from_slice(&input)
			.map_err(|error| std::io::Error::other(error.to_string()))?
	};

	let output = match args.output {
		Output::Bin => tangram_serialize::to_vec(&manifest)
			.map_err(|error| std::io::Error::other(error.to_string()))?,
		Output::Json => serde_json::to_vec(&manifest)
			.map_err(|error| std::io::Error::other(error.to_string()))?,
	};

	std::io::stdout().write_all(&output)?;

	Ok(())
}
