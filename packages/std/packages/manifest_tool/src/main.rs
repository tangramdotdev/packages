use clap::Parser;
use std::{fs::Permissions, os::unix::fs::PermissionsExt as _, path::PathBuf};

#[derive(clap::Parser)]
struct Args {
	#[command(subcommand)]
	command: Command,
}

#[derive(clap::Subcommand)]
enum Command {
	/// Write a new manifest.
	Write(Write),

	/// Read a manifest, if it exists.
	Read(Read),
}

#[derive(clap::Parser)]
struct Write {
	/// Specify the binary format to use.
	#[arg(long)]
	format: Option<manifest_tool::Format>,

	/// The file to use as the manifest input.
	#[arg(long)]
	manifest: PathBuf,

	/// The output to write. `manifest_tool` will not modify files in place.
	#[arg(long, short)]
	output: PathBuf,

	/// The binary file to modify.
	input: PathBuf,
}

#[derive(clap::Parser)]
struct Read {
	/// Specify the binary format to use.
	#[arg(long)]
	format: Option<manifest_tool::Format>,

	/// The output to write. `manifest_tool` will not modify files in place.
	#[arg(long, short)]
	output: PathBuf,

	/// The binary file to extract from.
	input: PathBuf,
}

fn main() {
	let args = Args::parse();
	match args.command {
		Command::Write(args) => {
			let manifest: serde_json::Value = serde_json::from_reader(
				&mut std::fs::File::open(args.manifest).expect("failed to open manifest file"),
			)
			.expect("failed to deserialize manifest");
			if args.output.exists() {
				std::fs::remove_file(&args.output).expect("failed to delete output");
			}
			std::fs::copy(&args.input, &args.output).expect("failed to copy file");
			std::fs::set_permissions(&args.output, Permissions::from_mode(0o755))
				.expect("failed to set output as writeable");
			manifest_tool::write_manifest(&args.output, &manifest, args.format);
		},
		Command::Read(args) => {
			let output = manifest_tool::read_manifest::<serde_json::Value>(args.input, args.format);
			serde_json::to_writer(
				std::fs::File::create(args.output).expect("failed to open output for writing"),
				&output,
			)
			.expect("failed to write manifest");
		},
	}
}
