use crate::{
	BinaryFormat, FileLocation, Options, SectionKind,
	elf::sys::{Elf32_Ehdr, Elf32_Shdr},
	file::File,
};
use paste::paste;
use std::ffi::{CStr, CString};
use zerocopy::{FromBytes, IntoBytes};

#[allow(dead_code, nonstandard_style)]
mod sys;
use sys::*;

#[derive(Default)]
pub struct Elf32;

#[derive(Default)]
pub struct Elf64;

impl Elf32 {
	fn matches(&self, file: &File) -> bool {
		let header = self.elf_header(file);
		&header.e_ident[0..5] == ELFMAG
			&& header.e_ident[EI_CLASS] == ELFCLASS32
			&& header.e_ident[EI_DATA] == ELFDATA2LSB
	}

	fn name(&self) -> &str {
		"elf32"
	}
}

impl Elf64 {
	fn matches(&self, file: &File) -> bool {
		let header = self.elf_header(file);
		&header.e_ident[0..5] == ELFMAG
			&& header.e_ident[EI_CLASS] == ELFCLASS64
			&& header.e_ident[EI_DATA] == ELFDATA2LSB
	}

	fn name(&self) -> &str {
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
				let mut index = ehdr.e_shstrndx as usize;
				if index == sys::SHN_XINDEX {
					let offset = ehdr.e_shoff as usize;
					let length = ehdr.e_shentsize as usize;
					index =
						paste! {[<$elf _Shdr>]::ref_from_bytes(&file[offset..(offset + length)]) }
							.expect("expected a section header")
							.sh_link as usize;
				}
				index
			}

			fn section_string_table(&self, file: &File) -> FileLocation {
				let ehdr = self.elf_header(file);
				let section_string_table_index = self.section_string_table_index(file);
				let location = FileLocation {
					offset: ehdr.e_shoff as usize
						+ section_string_table_index * size_of::<paste! {[<$elf _Shdr>]}>(),
					length: size_of::<paste! {[<$elf _Shdr>]}>(),
				};
				let section_header = paste! {[<$elf _Shdr>]::read_from_bytes(&file[location])}
					.expect("expected a section header");
				FileLocation {
					offset: section_header.sh_offset as usize,
					length: section_header.sh_size as usize,
				}
			}

			fn section_header_table(&self, file: &File) -> FileLocation {
				let ehdr = self.elf_header(file);
				FileLocation {
					offset: ehdr.e_shoff as usize,
					length: (ehdr.e_shnum * ehdr.e_shentsize) as usize,
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

			fn find_section(&self, file: &File, name: &str) -> Option<FileLocation> {
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
						let slice = &string_table[section.sh_name as usize..];
						if slice[0] == 0 {
							return None;
						}
						let section_name =
							CStr::from_bytes_until_nul(&string_table[section.sh_name as usize..])
								.expect("expected a null-terminated string");
						eprintln!("section {section_name:?}");
						if section_name == &name {
							let location = FileLocation {
								offset: section.sh_offset as usize,
								length: section.sh_size as usize,
							};
							return Some(location);
						}
						None
					})
			}

			fn add_section(&self, file: &mut File, options: Options<'_>) {
				let Options {
					name,
					kind,
					section,
					exec,
					write,
					..
				} = options;
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
						header.sh_size += name_len as paste! {[<$elf _Off>]};
						continue;
					}
					// If this section occurs after the original string_table location, update its offset.
					if header.sh_offset > string_table_location.end().try_into().unwrap() {
						header.sh_offset = name_len as paste! {[<$elf _Off>]}
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
				file.append(section)
					.expect("failed to write new section to end of file");

				// Create the new section.
				let sh_type = match kind {
					SectionKind::Code => sys::SHT_PROGBITS,
					SectionKind::Note => sys::SHT_NOTE,
				};
				let mut sh_flags = 0;
				if write {
					sh_flags |= sys::SHF_WRITE;
				}
				if exec {
					sh_flags |= sys::SHF_EXECINSTR;
				}
				let new_section_header = paste! {[<$elf _Shdr>]{
					sh_type: sh_type as _,
					sh_offset: new_section_offset as _,
					sh_size: section.len() as _,
					sh_addr: 0,
					sh_name: name_index as _,
					sh_flags: sh_flags as _,
					sh_link: 0,
					sh_info: 0,
					sh_addralign: 0,
					sh_entsize: 0,
				}};

				// Write the new section to the section table.
				section_table.extend_from_slice(new_section_header.as_bytes());

				// Get the offset of the new section table.
				let section_table_offset =
					dbg!(file.file_size().expect("failed to get the file size"));

				// Append the new section table.
				file.append(&section_table)
					.expect("failed to write the new section table to the file");

				// Update the elf header.
				let ehdr = self.elf_header_mut(file);
				ehdr.e_shnum += 1;
				ehdr.e_shoff = section_table_offset as paste! {[<$elf _Off>]}
			}
		}
	};
}
impl_elf!(Elf32);
impl_elf!(Elf64);
