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

	/// Embed a manifest and wrapper.
	Embed(Embed),
}

#[derive(clap::Parser)]
struct Write {
	/// Specify the binary format to use.
	#[arg(long)]
	format: Option<wrap::Format>,

	/// The file to use as the manifest input.
	#[arg(long)]
	manifest: PathBuf,

	/// The output to write. `wrap` will not modify files in place.
	#[arg(long, short)]
	output: PathBuf,

	/// The binary file to modify.
	input: PathBuf,
}

#[derive(clap::Parser)]
struct Read {
	/// Specify the binary format to use.
	#[arg(long)]
	format: Option<wrap::Format>,

	/// The output to write. `wrap` will not modify files in place.
	#[arg(long, short)]
	output: PathBuf,

	/// The binary file to extract from.
	input: PathBuf,
}

#[derive(clap::Parser)]
struct Embed {
	/// Specify the binary format to use.
	#[arg(long)]
	format: Option<wrap::Format>,

	/// The output to write. `wrap` will not modify files in place.
	#[arg(long, short)]
	output: PathBuf,

	/// The file to use as the manifest input.
	#[arg(long)]
	manifest: PathBuf,

	/// The wrapper executable.
	#[arg(long)]
	wrapper_exe: PathBuf,

	/// The wrapper binary.
	#[arg(long)]
	wrapper_bin: Option<PathBuf>,

	/// The path of the objcopy binary to use.
	#[arg(long)]
	objcopy_path: Option<PathBuf>,

	/// The input file to wrap.
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
			wrap::write_manifest(&args.output, &manifest, args.format);
		},
		Command::Read(args) => {
			let output = wrap::read_manifest::<serde_json::Value>(args.input, args.format);
			serde_json::to_writer(
				std::fs::File::create(args.output).expect("failed to open output for writing"),
				&output,
			)
			.expect("failed to write manifest");
		},
		Command::Embed(args) => {
			let manifest: serde_json::Value = serde_json::from_reader(
				&mut std::fs::File::open(args.manifest).expect("failed to open manifest file"),
			)
			.expect("failed to deserialize manifest");
			if let Some(path) = args.objcopy_path {
				wrap::set_objcopy_path(path);
			}
			if let Some(path) = args.wrapper_bin {
				wrap::set_wrapper_bin_path(path);
			}
			wrap::set_wrapper_exe_path(args.wrapper_exe);
			std::fs::copy(args.input, &args.output).expect("failed to copy input file");
			wrap::embed(&args.output, &manifest, args.format).expect("failed to embed the wrapper");
		},
	}
}
