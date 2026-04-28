use crate::{
	BinaryFormat, FileLocation,
	elf::sys::{Elf32_Ehdr, Elf32_Shdr},
	file::File,
};
use num::ToPrimitive as _;
use paste::paste;
use std::{ffi::CStr, path::Path};
use zerocopy::{FromBytes, IntoBytes};
#[allow(warnings, clippy::pedantic, clippy::all)]
pub(crate) mod sys;
use sys::{
	EI_CLASS, EI_DATA, ELFCLASS32, ELFCLASS64, ELFDATA2LSB, ELFMAG, Elf32_Off, Elf32_Phdr,
	Elf64_Ehdr, Elf64_Off, Elf64_Phdr, Elf64_Shdr,
};

const TANGRAM_WRAPPER_SECTION_NAME: &CStr = c".text.tg-wrapper";
const TANGRAM_MANIFEST_SECTION_NAME: &CStr = c".note.tg-manifest";

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

			#[allow(clippy::too_many_lines)]
			fn embed(&self, executable: &Path, manifest: &[u8]) -> std::io::Result<()> {
				let wrapper_bin_path = crate::wrapper_bin_path()
					.ok_or_else(|| std::io::Error::other("missing wrapper bin"))?;
				let wrapper_exe_path = crate::wrapper_exe_path()
					.ok_or_else(|| std::io::Error::other("missing wrapper exe"))?;

				let shdr_size = size_of::<paste! {[<$elf _Shdr>]}>();
				let phdr_size = size_of::<paste! {[<$elf _Phdr>]}>();

				// Check if wrapper and manifest sections exist; add them with objcopy if not.
				let file = File::open(executable, true)?;
				let string_table_loc = self.section_string_table(&file);
				let string_table = file[string_table_loc].to_vec();
				let ehdr = self.elf_header(&file);
				let shoff = ehdr.e_shoff.to_usize().unwrap();
				let shnum = ehdr.e_shnum.to_usize().unwrap();

				let mut needs_wrapper = true;
				let mut needs_manifest = true;
				for i in 0..shnum {
					let offset = shoff + i * shdr_size;
					let shdr = paste! {[<$elf _Shdr>]::read_from_bytes(&file[offset..offset + shdr_size])}
						.expect("invalid section header");
					let name_offset = shdr.sh_name.to_usize().unwrap();
					if name_offset >= string_table.len() {
						continue;
					}
					if let Ok(name) = CStr::from_bytes_until_nul(&string_table[name_offset..]) {
						if name == TANGRAM_WRAPPER_SECTION_NAME {
							needs_wrapper = false;
						} else if name == TANGRAM_MANIFEST_SECTION_NAME {
							needs_manifest = false;
						}
					}
				}
				drop(file);

				if needs_wrapper || needs_manifest {
					let objcopy = crate::objcopy_path();
					let mut cmd = std::process::Command::new(&objcopy);
					if needs_wrapper {
						cmd.arg(format!(
							"--add-section={}=/dev/null",
							TANGRAM_WRAPPER_SECTION_NAME.to_str().unwrap()
						));
					}
					if needs_manifest {
						cmd.arg(format!(
							"--add-section={}=/dev/null",
							TANGRAM_MANIFEST_SECTION_NAME.to_str().unwrap()
						));
					}
					cmd.arg(executable);
					let output = cmd.output()?;
					if !output.status.success() {
						tracing::error!(
							stdout = %String::from_utf8_lossy(&output.stdout),
							stderr = %String::from_utf8_lossy(&output.stderr),
							"objcopy failed",
						);
						return Err(std::io::Error::other("objcopy failed"));
					}
				}

				// Read wrapper binary and get entrypoint from wrapper ELF.
				let wrapper_bin = std::fs::read(&wrapper_bin_path)?;
				let wrapper_entry = {
					let wrapper_exe = File::open(&wrapper_exe_path, true)?;
					self.elf_header(&wrapper_exe).e_entry
				};

				// Open the executable for modification.
				let mut file = File::open(executable, false)?;
				let file_size = file.file_size()?.to_usize().unwrap();

				// --- Analysis ---
				let (phdr_offset, phdr_count) = {
					let ehdr = self.elf_header(&file);
					(
						ehdr.e_phoff.to_usize().unwrap(),
						ehdr.e_phnum.to_usize().unwrap(),
					)
				};

				// Find PT_INTERP header and compute max virtual address / alignment.
				let mut pt_interp_index: Option<usize> = None;
				let mut max_vaddr = 0;
				let mut max_align = 0;
				for i in 0..phdr_count {
					let off = phdr_offset + i * phdr_size;
					let phdr = paste! {[<$elf _Phdr>]::read_from_bytes(&file[off..off + phdr_size])}
						.expect("invalid program header");
					if phdr.p_type == sys::PT_LOAD {
						max_vaddr = max_vaddr.max(phdr.p_vaddr + phdr.p_memsz);
						max_align = max_align.max(phdr.p_align);
					}
					if phdr.p_type == sys::PT_INTERP {
						assert!(pt_interp_index.is_none(), "multiple interpreters found");
						pt_interp_index = Some(i);
					}
				}

				// Find wrapper and manifest section headers in a single pass.
				let mut wrapper_shdr_offset: Option<usize> = None;
				let mut manifest_shdr_offset: Option<usize> = None;
				{
					let string_table_loc = self.section_string_table(&file);
					let string_table = file[string_table_loc].to_vec();
					let ehdr = self.elf_header(&file);
					let shoff = ehdr.e_shoff.to_usize().unwrap();
					let shnum = ehdr.e_shnum.to_usize().unwrap();

					for i in 0..shnum {
						let offset = shoff + i * shdr_size;
						let shdr = paste! {[<$elf _Shdr>]::read_from_bytes(&file[offset..offset + shdr_size])}
							.expect("invalid section header");
						let name_offset = shdr.sh_name.to_usize().unwrap();
						if name_offset >= string_table.len() {
							continue;
						}
						if let Ok(name) = CStr::from_bytes_until_nul(&string_table[name_offset..]) {
							if name == TANGRAM_WRAPPER_SECTION_NAME {
								wrapper_shdr_offset = Some(offset);
							} else if name == TANGRAM_MANIFEST_SECTION_NAME {
								manifest_shdr_offset = Some(offset);
							}
						}
					}
				}

				// Get the offsets of each section header.
				let wrapper_shdr_offset = wrapper_shdr_offset
					.ok_or_else(|| std::io::Error::other("missing wrapper section"))?;
				let manifest_shdr_offset = manifest_shdr_offset
					.ok_or_else(|| std::io::Error::other("missing manifest section"))?;

				// Compute the data layout.
				let wrapper_data_size = wrapper_bin.len() + manifest.len();
				let wrapper_vaddr = align(max_vaddr.to_usize().unwrap(), max_align.to_usize().unwrap())
					.try_into()
					.unwrap();
				let wrapper_memsz = align(wrapper_data_size, max_align.to_usize().unwrap())
					.try_into()
					.unwrap();

				// Determine wrapper offset and build new phdr table if needed.
				let new_phdr_table: Option<(Vec<u8>, usize)>;
				let wrapper_offset: usize;

				if let Some(interpreter_index) = pt_interp_index {
					// Reuse PT_INTERP header for the stub segment.
					wrapper_offset = align(file_size, max_align.to_usize().unwrap());
					new_phdr_table = None;

					let stub_segment = paste! {[<$elf _Phdr>] {
						p_type: sys::PT_LOAD,
						p_flags: sys::PF_R | sys::PF_X,
						p_offset: wrapper_offset.try_into().unwrap(),
						p_vaddr: wrapper_vaddr,
						p_paddr: wrapper_vaddr,
						p_filesz: wrapper_data_size.try_into().unwrap(),
						p_memsz: wrapper_memsz,
						p_align: max_align,
					}};
					let offset = phdr_offset + interpreter_index * phdr_size;
					file[offset..offset + phdr_size].copy_from_slice(stub_segment.as_bytes());
				} else {
					// Create a new section header if there's no PT_INTERP we can abuse.
					let headers_offset = align(file_size, 64);
					let new_count = phdr_count + 1;
					let headers_size = new_count * phdr_size;
					wrapper_offset = align(headers_offset + headers_size, max_align.to_usize().unwrap());

					let stub_segment = paste! {[<$elf _Phdr>]{
						p_type: sys::PT_LOAD,
						p_flags: sys::PF_R | sys::PF_X,
						p_offset: wrapper_offset.try_into().unwrap(),
						p_vaddr: wrapper_vaddr,
						p_paddr: wrapper_vaddr,
						p_filesz: wrapper_data_size.try_into().unwrap(),
						p_memsz: wrapper_memsz,
						p_align: max_align,
					}};

					let mut bytes = Vec::with_capacity(headers_size);

					// Copy existing loadable segments first.
					for i in 0..phdr_count {
						let off = phdr_offset + i * phdr_size;
						let phdr = paste! {[<$elf _Phdr>]::read_from_bytes(&file[off..off + phdr_size])}.unwrap();
						assert!(phdr.p_type != sys::PT_PHDR, "unexpected PT_PHDR");
						if phdr.p_type == sys::PT_LOAD {
							bytes.extend_from_slice(phdr.as_bytes());
						}
					}

					// Add the new stub segment.
					bytes.extend_from_slice(stub_segment.as_bytes());

					// Copy non-loadable segments.
					for i in 0..phdr_count {
						let off = phdr_offset + i * phdr_size;
						let phdr = paste! {[<$elf _Phdr>]::read_from_bytes(&file[off..off + phdr_size])}.unwrap();
						if phdr.p_type != sys::PT_LOAD {
							bytes.extend_from_slice(phdr.as_bytes());
						}
					}

					assert_eq!(bytes.len(), headers_size);
					new_phdr_table = Some((bytes, headers_offset));
				}

				// Patch section headers.
				let mut wrapper_shdr = paste! {[<$elf _Shdr>]::read_from_bytes(
					&file[wrapper_shdr_offset..wrapper_shdr_offset + shdr_size],
				)}
				.unwrap();
				wrapper_shdr.sh_type = sys::SHT_PROGBITS;
				wrapper_shdr.sh_flags = (sys::SHF_ALLOC | sys::SHF_EXECINSTR).try_into().unwrap();
				wrapper_shdr.sh_addr = wrapper_vaddr;
				wrapper_shdr.sh_offset = wrapper_offset.try_into().unwrap();
				wrapper_shdr.sh_size = wrapper_data_size.try_into().unwrap();
				wrapper_shdr.sh_link = 0;
				wrapper_shdr.sh_addralign = max_align;
				wrapper_shdr.sh_entsize = 0;
				file[wrapper_shdr_offset..wrapper_shdr_offset + shdr_size]
					.copy_from_slice(wrapper_shdr.as_bytes());

				let mut manifest_shdr = paste! {[<$elf _Shdr>]::read_from_bytes(
					&file[manifest_shdr_offset..manifest_shdr_offset + shdr_size],
				)}
				.unwrap();
				manifest_shdr.sh_type = sys::SHT_NOTE;
				manifest_shdr.sh_flags = 0;
				manifest_shdr.sh_addr = (wrapper_vaddr.to_usize().unwrap() + wrapper_bin.len()).try_into().unwrap();
				manifest_shdr.sh_offset =
					(wrapper_offset.to_usize().unwrap() + wrapper_bin.len()).try_into().unwrap();
				manifest_shdr.sh_size =
					(manifest.len() + size_of::<crate::Footer>()).try_into().unwrap();
				manifest_shdr.sh_link = 0;
				manifest_shdr.sh_addralign = 0;
				manifest_shdr.sh_entsize = 0;
				file[manifest_shdr_offset..manifest_shdr_offset + shdr_size]
					.copy_from_slice(manifest_shdr.as_bytes());

				// Create the footer.
				let footer = crate::Footer {
					size: manifest.len().to_u64().unwrap(),
					version: crate::VERSION,
					magic: crate::MAGIC,
				};

				// Patch the entrypoint.
				let ehdr = self.elf_header_mut(&mut file);
				ehdr.e_entry = wrapper_vaddr + wrapper_entry;

				// Patch program header table or sort existing headers.
				if let Some((_, headers_offset)) = &new_phdr_table {
					let ehdr = self.elf_header_mut(&mut file);
					ehdr.e_phoff = (*headers_offset).try_into().unwrap();
					ehdr.e_phnum = (phdr_count + 1).to_u16().unwrap();
				} else {
					// Collect PT_LOAD indices and their raw bytes.
					let mut load_positions = Vec::new();
					let mut load_entries: Vec<Vec<u8>> = Vec::new();
					for i in 0..phdr_count {
						let off = phdr_offset + i * phdr_size;
						let phdr = paste! {[<$elf _Phdr>]::ref_from_bytes(&file[off..off + phdr_size])}.unwrap();
						if phdr.p_type == sys::PT_LOAD {
							load_positions.push(i);
							load_entries.push(file[off..off + phdr_size].to_vec());
						}
					}

					load_entries.sort_unstable_by_key(|bytes| {
						paste! {[<$elf _Phdr>]::ref_from_bytes(bytes)}.unwrap().p_vaddr
					});

					// Write sorted entries back to their original PT_LOAD positions.
					for (&pos, entry) in load_positions.iter().zip(load_entries.iter()) {
						let off = phdr_offset + pos * phdr_size;
						file[off..off + phdr_size].copy_from_slice(entry);
					}
				}

				// Write new program header table if necessary.
				if let Some((phdr_bytes, headers_offset)) = new_phdr_table {
					let padding = headers_offset - file_size;
					if padding > 0 {
						file.append(&vec![0u8; padding])?;
					}
					file.append(&phdr_bytes)?;
					let padding = wrapper_offset - headers_offset - phdr_bytes.len();
					if padding > 0 {
						file.append(&vec![0u8; padding])?;
					}
				} else {
					// Pad to stub offset.
					let padding = wrapper_offset - file_size;
					if padding > 0 {
						file.append(&vec![0u8; padding])?;
					}
				}

				// Append wrapper binary.
				file.append(&wrapper_bin)?;

				// Append manifest.
				file.append(manifest)?;

				// Append footer.
				file.append(footer.as_bytes())?;

				Ok(())
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
				// Convert the name.
				let name = TANGRAM_MANIFEST_SECTION_NAME.to_owned();

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
				let name = TANGRAM_MANIFEST_SECTION_NAME.to_bytes_with_nul();
				let name_len = name.len();

				// Get the string table and section table locations.
				let string_table_index = self.section_string_table_index(file);
				let string_table_location = self.section_string_table(file);
				let mut section_table_location = self.section_header_table(file);

				// Get the actual data.
				let mut string_table = file[string_table_location].to_vec();
				let mut section_table = file[section_table_location].to_vec();

				// Add to the string table.
				let name_index = string_table.len();
				string_table.extend_from_slice(name);
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
					if name == TANGRAM_MANIFEST_SECTION_NAME {
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

			fn embed(&self, path: &std::path::Path, data: &[u8]) -> std::io::Result<()> {
				self.embed(path, data)
			}
		}
	};
}
impl_elf!(Elf32);
impl_elf!(Elf64);

fn align(m: usize, n: usize) -> usize {
	(m + n - 1) & !(n - 1)
}
