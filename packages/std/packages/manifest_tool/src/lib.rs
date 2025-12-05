pub use file::File;
use num::ToPrimitive;
use std::{io::Read, ops::Range, path::Path};
use zerocopy::{FromZeros as _, IntoBytes as _};

mod elf;
mod file;
mod mach;

#[derive(
	Debug,
	Clone,
	Copy,
	zerocopy::FromBytes,
	zerocopy::IntoBytes,
	zerocopy::Immutable,
	zerocopy::KnownLayout,
)]
#[repr(C)]
struct Footer {
	pub size: u64,
	pub version: u64,
	pub magic: [u8; 8],
}

const MAGIC: [u8; 8] = *b"tangram\0";
const VERSION: u64 = 0;

#[derive(serde::Serialize)]
pub struct Output<T> {
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub manifest: Option<T>,

	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub location: Option<FileLocation>,
}

#[derive(Copy, Clone, Debug, clap::ValueEnum)]
pub enum Format {
	Elf32,
	Elf64,
	Mach64,
	MachUniversal,
}

#[derive(serde::Serialize, Copy, Clone, Debug)]
pub struct FileLocation {
	pub offset: usize,
	pub length: usize,
}

trait BinaryFormat {
	fn matches(&self, file: &File) -> bool;
	fn name(&self) -> &str;
	fn read_manifest(&self, file: &File) -> Option<FileLocation>;
	fn write_manifest(&self, file: &mut File, data: &[u8]);
	fn overwrite_manifest(&self, file: &mut File, data: &[u8]);
}

impl FileLocation {
	#[must_use]
	pub fn end(&self) -> usize {
		self.offset + self.length
	}

	#[must_use]
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

pub fn write_manifest(
	path: impl AsRef<Path>,
	manifest: &impl serde::Serialize,
	format: Option<Format>,
) {
	let mut file = File::open(path.as_ref(), false).expect("failed to open output file");
	let format = create_format(&file, format);
	let mut data = serde_json::to_vec(&manifest).expect("failed to serialize manifest");
	let footer = Footer {
		size: data.len().try_into().unwrap(),
		version: VERSION,
		magic: MAGIC,
	};
	data.extend_from_slice(footer.as_bytes());
	format.overwrite_manifest(&mut file, &data);
	assert!(format.read_manifest(&file).is_some(), "expected a manifest");
}

pub fn read_manifest<T: serde::de::DeserializeOwned>(
	path: impl AsRef<Path>,
	format: Option<Format>,
) -> Output<T> {
	let file = File::open(path, true).expect("failed to open output file");
	let format = create_format(&file, format);
	let Some(location) = format.read_manifest(&file) else {
		return Output {
			manifest: None,
			location: None,
		};
	};
	let data = &file[location];
	let mut footer = Footer::new_zeroed();
	footer
		.as_mut_bytes()
		.copy_from_slice(&data[data.len() - size_of::<Footer>()..]);
	assert_eq!(footer.magic, MAGIC, "invalid manifest footer");
	assert_eq!(footer.version, VERSION, "invalid manifest version");
	let data = serde_json::from_slice(&data[0..footer.size.to_usize().unwrap()])
		.expect("failed to deserialize the manifest");
	Output {
		manifest: Some(data),
		location: Some(location),
	}
}

pub fn get_format(path: impl AsRef<Path>) -> std::io::Result<Option<Format>> {
	let mut magic = [0u8; 16];
	std::fs::File::open(path)?.read_exact(&mut magic)?;
	if magic.starts_with(elf::sys::ELFMAG) {
		if magic[elf::sys::EI_DATA] != elf::sys::ELFDATA2LSB {
			return Ok(None);
		}
		if magic[elf::sys::EI_CLASS] == elf::sys::ELFCLASS32 {
			return Ok(Some(Format::Elf64));
		}
		if magic[elf::sys::EI_CLASS] == elf::sys::ELFCLASS64 {
			return Ok(Some(Format::Elf64));
		}
	}
	if magic.starts_with(mach::sys::MH_MAGIC_64.as_bytes()) {
		return Ok(Some(Format::Mach64));
	}
	Ok(None)
}

fn create_format(file: &File, hint: Option<Format>) -> Box<dyn BinaryFormat + 'static> {
	let elf32 = elf::Elf32;
	let elf64 = elf::Elf64;
	let mach64 = mach::Mach64;
	let mach_universal = mach::MachUniversal;
	let format = hint
		.or_else(|| {
			if elf32.matches(file) {
				return Some(Format::Elf32);
			}
			if elf64.matches(file) {
				return Some(Format::Elf64);
			}
			if mach64.matches(file) {
				return Some(Format::Mach64);
			}
			if mach_universal.matches(file) {
				return Some(Format::MachUniversal);
			}
			None
		})
		.expect("unknown input file format");
	let format = match format {
		Format::Elf32 => Box::new(elf32) as Box<dyn BinaryFormat>,
		Format::Elf64 => Box::new(elf64),
		Format::Mach64 => Box::new(mach64),
		Format::MachUniversal => Box::new(mach_universal),
	};
	assert!(format.matches(file), "invalid {} file", format.name());
	tracing::info!(format = %format.name(), "created format");
	format
}

pub fn detect_format(path: impl AsRef<Path>) -> std::io::Result<Option<Format>> {
	let elf32 = elf::Elf32;
	let elf64 = elf::Elf64;
	let mach64 = mach::Mach64;
	let mach_universal = mach::MachUniversal;
	let file = File::open(path, true)?;
	if elf32.matches(&file) {
		return Ok(Some(Format::Elf32));
	}
	if elf64.matches(&file) {
		return Ok(Some(Format::Elf64));
	}
	if mach64.matches(&file) {
		return Ok(Some(Format::Mach64));
	}
	if mach_universal.matches(&file) {
		return Ok(Some(Format::MachUniversal));
	}
	Ok(None)
}
