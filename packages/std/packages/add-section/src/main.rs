use add_section::{Format, Options, SectionKind};
use clap::Parser;
use std::path::PathBuf;

use add_section;

#[derive(clap::Parser)]
struct Args {
	#[arg(long, short)]
	input: PathBuf,

	#[arg(long, short)]
	output: PathBuf,

	#[arg(long)]
	format: Option<Format>,

	#[arg(long)]
	section: String,

	#[arg(long)]
	write: bool,

	#[arg(long)]
	exec: bool,

	#[arg(long)]
	kind: SectionKind,
}

fn main() {
	let args = Args::parse();

	// Get the name/path of the section.
	let (name, path) = args
		.section
		.split_once('=')
		.expect("expected a section name and path");
	let section = std::fs::read(path).expect("failed to read section data");

	// Create the section options.
	let options = Options {
		name,
		section: &section,
		write: args.write,
		exec: args.exec,
		kind: args.kind,
		format: args.format,
	};

	// Copy the Output.
	std::fs::copy(args.input, &args.output).expect("failed to copy file");

	// Do the work.
	add_section::add_section(&args.output, options);
}
