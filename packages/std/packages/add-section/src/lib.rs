pub use file::File;
use std::{ops::Range, path::Path};

mod elf;
mod file;
mod mach;

#[derive(Copy, Clone, Debug, clap::ValueEnum)]
pub enum SectionKind {
	Note,
	Code,
}

#[derive(Copy, Clone, Debug)]
pub struct Options<'a> {
	pub format: Option<Format>,
	pub name: &'a str,
	pub section: &'a [u8],
	pub exec: bool,
	pub kind: SectionKind,
	pub write: bool,
}

#[derive(Copy, Clone, Debug, clap::ValueEnum)]
pub enum Format {
	Elf32,
	Elf64,
	Mach,
}

#[derive(Copy, Clone, Debug)]
pub(crate) struct FileLocation {
	pub offset: usize,
	pub length: usize,
}

trait BinaryFormat {
	fn matches(&self, file: &File) -> bool;
	fn name(&self) -> &str;
	fn find_section(&self, file: &File, name: &str) -> Option<FileLocation>;
	fn add_section(&self, file: &mut File, options: Options<'_>);
}

impl FileLocation {
	pub fn end(&self) -> usize {
		self.offset + self.length
	}

	pub fn range(&self) -> Range<usize> {
		self.offset..self.end()
	}
}

impl std::ops::Index<FileLocation> for [u8] {
	type Output = [u8];
	fn index(&self, index: FileLocation) -> &Self::Output {
		self.index(index.range())
	}
}

impl std::ops::IndexMut<FileLocation> for [u8] {
	fn index_mut(&mut self, index: FileLocation) -> &mut Self::Output {
		self.index_mut(index.range())
	}
}

pub fn add_section(path: &Path, options: Options) {
	let elf32 = elf::Elf32::default();
	let elf64 = elf::Elf64::default();
	let mach = mach::Mach::default();
	let mut file = File::open(path).expect("failed to open output file");
	let format = options
		.format
		.or_else(|| {
			if elf32.matches(&file) {
				return Some(Format::Elf32);
			}
			if elf64.matches(&file) {
				return Some(Format::Elf64);
			}
			if mach.matches(&file) {
				return Some(Format::Mach);
			}
			None
		})
		.expect("unknown input file format");
	let format: &dyn BinaryFormat = match format {
		Format::Elf32 => &elf32,
		Format::Elf64 => &elf64,
		Format::Mach => &mach,
	};
	tracing::trace!(format = format.name(), "reading binary");
	if let Some(location) = format.find_section(&file, options.name) {
		tracing::trace!(?location, name = %options.name, "found section, not overwriting");
		return;
	}
	tracing::trace!(name = %options.name, "writing section");
	format.add_section(&mut file, options);
}
