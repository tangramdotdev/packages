use crate::{
	BinaryFormat, FileLocation,
	elf::sys::{Elf32_Ehdr, Elf32_Shdr},
	file::File,
};
use num::ToPrimitive as _;
use paste::paste;
use std::ffi::{CStr, CString};
use zerocopy::{FromBytes, IntoBytes};
#[allow(warnings, clippy::pedantic, clippy::all)]
pub(crate) mod sys;
use sys::{
	EI_CLASS, EI_DATA, ELFCLASS32, ELFCLASS64, ELFDATA2LSB, ELFMAG, Elf32_Off, Elf64_Ehdr,
	Elf64_Off, Elf64_Shdr,
};

#[derive(Default)]
pub struct Elf32;

#[derive(Default)]
pub struct Elf64;

impl Elf32 {
	fn matches(&self, file: &File) -> bool {
		let header = self.elf_header(file);
		header.e_ident[0..4] == ELFMAG[0..4]
			&& header.e_ident[EI_CLASS] == ELFCLASS32
			&& header.e_ident[EI_DATA] == ELFDATA2LSB
	}

	#[allow(clippy::unused_self)]
	fn name(&self) -> &'static str {
		"elf32"
	}
}

impl Elf64 {
	fn matches(&self, file: &File) -> bool {
		let header = self.elf_header(file);
		header.e_ident[0..4] == ELFMAG[0..4]
			&& header.e_ident[EI_CLASS] == ELFCLASS64
			&& header.e_ident[EI_DATA] == ELFDATA2LSB
	}

	#[allow(clippy::unused_self)]
	fn name(&self) -> &'static str {
		"elf64"
	}
}

macro_rules! impl_elf {
	($elf:ident) => {
		impl $elf {
			fn elf_header<'a>(&self, file: &'a File) -> &'a paste! {[<$elf _Ehdr>]} {
				paste! {[<$elf _Ehdr>]::ref_from_bytes(&file[0..size_of::<[<$elf _Ehdr>]>()])}
					.expect("expected an header")
			}

			fn elf_header_mut<'a>(&self, file: &'a mut File) -> &'a mut paste! {[<$elf _Ehdr>]} {
				paste! {[<$elf _Ehdr>]::mut_from_bytes(&mut file[0..size_of::<[<$elf _Ehdr>]>()])}
					.expect("expected an header")
			}

			fn section_string_table_index(&self, file: &File) -> usize {
				let ehdr = self.elf_header(file);
				let mut index = usize::try_from(ehdr.e_shstrndx).unwrap();
				if index == sys::SHN_XINDEX {
					let offset = usize::try_from(ehdr.e_shoff).unwrap();
					let length = usize::try_from(ehdr.e_shentsize).unwrap();
					index =
						paste! {[<$elf _Shdr>]::ref_from_bytes(&file[offset..(offset + length)]) }
							.expect("expected a section header")
							.sh_link
							.try_into()
							.unwrap();
				}
				index
			}

			fn section_string_table(&self, file: &File) -> FileLocation {
				let ehdr = self.elf_header(file);
				let section_string_table_index = self.section_string_table_index(file);
				let location = FileLocation {
					offset: ehdr.e_shoff.to_usize().unwrap()
						+ section_string_table_index * size_of::<paste! {[<$elf _Shdr>]}>(),
					length: size_of::<paste! {[<$elf _Shdr>]}>(),
				};
				let section_header = paste! {[<$elf _Shdr>]::read_from_bytes(&file[location])}
					.expect("expected a section header");
				FileLocation {
					offset: section_header.sh_offset.to_usize().unwrap(),
					length: section_header.sh_size.to_usize().unwrap(),
				}
			}

			fn section_header_table(&self, file: &File) -> FileLocation {
				let ehdr = self.elf_header(file);
				FileLocation {
					offset: ehdr.e_shoff.to_usize().unwrap(),
					length: (ehdr.e_shnum * ehdr.e_shentsize).to_usize().unwrap(),
				}
			}
		}

		impl BinaryFormat for $elf {
			fn matches(&self, file: &File) -> bool {
				self.matches(file)
			}

			fn name(&self) -> &str {
				self.name()
			}

			fn read_manifest(&self, file: &File) -> Option<FileLocation> {
				let name = ".note.tg-manifest";

				// Convert the name.
				let name = CString::new(name).unwrap();

				// Get the index of the section containing the section-name string table.
				let string_table = &file[self.section_string_table(file)];
				let sections = &file[self.section_header_table(file)];

				// Iterate the string table.
				sections
					.chunks_exact(size_of::<paste! {[<$elf _Shdr>]}>())
					.map(|chunk| {
						paste! {[<$elf _Shdr>]::read_from_bytes(chunk)}
							.expect("expected a section_header")
					})
					.find_map(|section| {
						let slice = &string_table[section.sh_name.to_usize().unwrap()..];
						if slice[0] == 0 {
							return None;
						}
						let section_name = CStr::from_bytes_until_nul(
							&string_table[section.sh_name.to_usize().unwrap()..],
						)
						.expect("expected a null-terminated string");
						if section_name == &name {
							let location = FileLocation {
								offset: section.sh_offset.to_usize().unwrap(),
								length: section.sh_size.to_usize().unwrap(),
							};
							return Some(location);
						}
						None
					})
			}

			fn write_manifest(&self, file: &mut File, data: &[u8]) {
				let name = ".note.tg-manifest";
				let name_len = name.len() + 1;

				// Get the string table and section table locations.
				let string_table_index = self.section_string_table_index(file);
				let string_table_location = self.section_string_table(file);
				let mut section_table_location = self.section_header_table(file);

				// Get the actual data.
				let mut string_table = file[string_table_location].to_vec();
				let mut section_table = file[section_table_location].to_vec();

				// Add to the string table.
				let name_index = string_table.len();
				string_table.extend_from_slice(name.as_bytes());
				string_table.push(0);

				// Update existing sections.
				for (index, chunk) in section_table
					.chunks_exact_mut(size_of::<paste! {[<$elf _Shdr>]}>())
					.enumerate()
				{
					let header = paste! {[<$elf _Shdr>]::mut_from_bytes(chunk)}
						.expect("expected a section header");
					if index == string_table_index {
						header.sh_size += <paste! {[<$elf _Off>]}>::try_from(name_len).unwrap();
						continue;
					}
					// If this section occurs after the original string_table location, update its offset.
					if header.sh_offset > string_table_location.end().try_into().unwrap() {
						header.sh_offset = <paste! {[<$elf _Off>]}>::try_from(name_len).unwrap();
					}
				}

				// Now the hard part:
				// Insert the new string table at the offset of the original.
				file.insert(&string_table, string_table_location.offset as u64)
					.expect("failed to insert string table");

				// Delete the old section table.
				section_table_location.offset += name_len;
				file.delete(section_table_location)
					.expect("failed to delete section table");

				// Get the offset of the end of the file.
				let new_section_offset = file.file_size().expect("failed to get the file size");

				// Write the new section.
				file.append(data)
					.expect("failed to write new section to end of file");

				// Create the new section.
				let sh_type = sys::SHT_NOTE;
				let sh_flags = 0;
				let new_section_header = paste! {[<$elf _Shdr>]{
					sh_type: sh_type .try_into().unwrap(),
					sh_offset: new_section_offset .try_into().unwrap(),
					sh_size: data.len() .try_into().unwrap(),
					sh_addr: 0,
					sh_name: name_index .try_into().unwrap(),
					sh_flags: sh_flags .try_into().unwrap(),
					sh_link: 0,
					sh_info: 0,
					sh_addralign: 0,
					sh_entsize: 0,
				}};

				// Write the new section to the section table.
				section_table.extend_from_slice(new_section_header.as_bytes());

				// Get the offset of the new section table.
				let section_table_offset = file.file_size().expect("failed to get the file size");

				// Append the new section table.
				file.append(&section_table)
					.expect("failed to write the new section table to the file");

				// Update the elf header.
				let ehdr = self.elf_header_mut(file);
				ehdr.e_shnum += 1;
				ehdr.e_shoff = <paste! {[<$elf _Off>]}>::try_from(section_table_offset).unwrap();
			}

			fn overwrite_manifest(&self, file: &mut File, data: &[u8]) {
				// Get the existing manifest location.
				let Some(old) = self.read_manifest(file) else {
					self.write_manifest(file, data);
					return;
				};

				// Compute the difference of the two sections.
				let diff = if data.len() >= old.length {
					isize::try_from(data.len() - old.length).unwrap()
				} else {
					-isize::try_from(old.length - data.len()).unwrap()
				};

				// Get the string table and section table locations.
				let string_table_location = self.section_string_table(file);
				let section_table_location = self.section_header_table(file);

				// Get the actual data.
				let string_table = file[string_table_location].to_vec();
				let section_table = &mut file[section_table_location];

				// Update existing sections.
				for chunk in section_table.chunks_exact_mut(size_of::<paste! {[<$elf _Shdr>]}>()) {
					let header = paste! {[<$elf _Shdr>]::mut_from_bytes(chunk)}
						.expect("expected a section header");
					let name = CStr::from_bytes_until_nul(
						&string_table[usize::try_from(header.sh_name).unwrap()..],
					)
					.unwrap();
					if name == c".note.tg-manifest" {
						let old_size = isize::try_from(header.sh_size).unwrap();
						let new_size = old_size + diff;
						header.sh_size = new_size.try_into().unwrap();
						break;
					}
				}

				// Update the header.
				let old_offset = isize::try_from(self.elf_header(file).e_shoff).unwrap();
				if old_offset >= isize::try_from(old.offset).unwrap() {
					let new_offset = old_offset + diff;
					self.elf_header_mut(file).e_shoff = new_offset.try_into().unwrap();
				}

				// Replace it.
				file.replace(old, data)
					.expect("failed to overwrite existing manifest");
			}
		}
	};
}
impl_elf!(Elf32);
impl_elf!(Elf64);
