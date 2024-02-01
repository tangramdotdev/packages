use std::str::FromStr;

use clap::Parser;
use tangram_client as tg;
use tangram_error::{Result, WrapErr};
use tokio::io::AsyncReadExt;
use tracing_subscriber::prelude::*;

#[derive(Debug, clap::Parser)]
#[command(
	about = env!("CARGO_PKG_DESCRIPTION"),
	long_version = env!("CARGO_PKG_VERSION"),
	name = env!("CARGO_CRATE_NAME"),
	verbatim_doc_comment,
	version = env!("CARGO_PKG_VERSION"),
)]
pub struct Args {
	#[command(subcommand)]
	pub command: Command,
}

#[derive(Debug, clap::Subcommand)]
pub enum Command {
	Create(CreateArgs),
	Consume(ConsumeArgs),
}

#[derive(Debug, clap::Args)]
pub struct CreateArgs {
	#[arg(long, default_value = "test")]
	pub contents: String,
	#[arg(long, default_value = "false")]
	pub checkout: bool,
}

#[derive(Debug, clap::Args)]
pub struct ConsumeArgs {
	pub id: tg::artifact::Id,
}

#[tokio::main]
async fn main() {
	if let Err(e) = main_inner().await {
		eprintln!("vfs test failed: {e}");
		tracing::trace!("{}", e.trace());
		std::process::exit(1);
	}
}

async fn main_inner() -> Result<()> {
	let args = Args::parse();

	let tg = init().await?;

	match args.command {
		Command::Create(args) => create(&tg, args).await?,
		Command::Consume(args) => consume(&tg, args).await?,
	}

	Ok(())
}

/// Set up tracing and connect to the Tangram server.
async fn init() -> Result<tg::Client> {
	// Set up tracing.
	let tracing_level = std::env::var("TANGRAM_VFS_TEST_TRACING").ok();
	setup_tracing(tracing_level.as_deref());

	// Connect to the Tangram server.
	let tg = tg::Client::with_runtime()?;
	tg.connect().await?;

	// Return handle.
	Ok(tg)
}

/// Create a new Tangram artifact.
async fn create(tg: &dyn tg::Handle, args: CreateArgs) -> Result<()> {
	let reader = std::io::Cursor::new(args.contents);
	let blob = tg::Blob::with_reader(tg, reader).await?;
	let file = tg::File::builder(blob).build();
	let id = file.id(tg).await?;
	if args.checkout {
		let arg = tg::artifact::CheckOutArg {
			artifact: id.clone().into(),
			path: None,
		};
		tg.check_out_artifact(arg).await?;
	}
	println!("{id}");
	Ok(())
}

/// Consume a Tangram artifact.
async fn consume(_tg: &dyn tg::Handle, args: ConsumeArgs) -> Result<()> {
	let base_path = std::path::PathBuf::from_str("/.tangram/artifacts").unwrap();
	let file_path = base_path.join(args.id.to_string());
	let mut file = tokio::fs::File::open(file_path)
		.await
		.wrap_err("Could not open file")?;
	let mut contents = String::new();
	file.read_to_string(&mut contents)
		.await
		.wrap_err("Could not read file")?;
	println!("{contents}");
	Ok(())
}

fn setup_tracing(targets: Option<&str>) {
	let targets_layer =
		targets.and_then(|filter| filter.parse::<tracing_subscriber::filter::Targets>().ok());

	// If tracing is enabled, create and initialize the subscriber.
	if let Some(targets_layer) = targets_layer {
		let format_layer = tracing_subscriber::fmt::layer()
			.compact()
			.with_ansi(false)
			.with_span_events(tracing_subscriber::fmt::format::FmtSpan::NEW)
			.with_writer(std::io::stderr);
		let subscriber = tracing_subscriber::registry()
			.with(targets_layer)
			.with(format_layer);
		subscriber.init();
	}
}
