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

			/// Get the offset of the program header of the loadable segment whose file contents end
			/// last. The manifest goes at the end of it, where the wrapper looks for the footer.
			fn last_loadable_segment(&self, file: &File) -> Option<usize> {
				let phdr_size = size_of::<paste! {[<$elf _Phdr>]}>();
				let (phdr_offset, phdr_count) = {
					let ehdr = self.elf_header(file);
					(
						ehdr.e_phoff.to_usize().unwrap(),
						ehdr.e_phnum.to_usize().unwrap(),
					)
				};
				let mut last: Option<(usize, usize)> = None;
				for i in 0..phdr_count {
					let offset = phdr_offset + i * phdr_size;
					let phdr = paste! {[<$elf _Phdr>]::read_from_bytes(&file[offset..offset + phdr_size])}
						.expect("expected a program header");
					if phdr.p_type != sys::PT_LOAD {
						continue;
					}
					let end = phdr.p_offset.to_usize().unwrap() + phdr.p_filesz.to_usize().unwrap();
					if last.is_none_or(|(_, last_end)| end > last_end) {
						last = Some((offset, end));
					}
				}
				last.map(|(offset, _)| offset)
			}

			/// Get the end of the last address the loadable segments occupy, the largest alignment
			/// they require, and the distance between their addresses and their offsets.
			fn image_extent(&self, file: &File) -> (usize, usize, usize) {
				let phdr_size = size_of::<paste! {[<$elf _Phdr>]}>();
				let (phdr_offset, phdr_count) = {
					let ehdr = self.elf_header(file);
					(
						ehdr.e_phoff.to_usize().unwrap(),
						ehdr.e_phnum.to_usize().unwrap(),
					)
				};
				let mut max_vaddr = 0;
				let mut max_align = 1;
				let mut first: Option<(usize, usize)> = None;
				for i in 0..phdr_count {
					let offset = phdr_offset + i * phdr_size;
					let phdr = paste! {[<$elf _Phdr>]::read_from_bytes(&file[offset..offset + phdr_size])}
						.expect("expected a program header");
					if phdr.p_type != sys::PT_LOAD {
						continue;
					}
					let vaddr = phdr.p_vaddr.to_usize().unwrap();
					max_vaddr = max_vaddr.max(vaddr + phdr.p_memsz.to_usize().unwrap());
					max_align = max_align.max(phdr.p_align.to_usize().unwrap());
					if first.is_none_or(|(current, _)| vaddr < current) {
						first = Some((vaddr, phdr.p_offset.to_usize().unwrap()));
					}
				}
				let (vaddr, offset) = first.expect("expected a loadable segment");
				(max_vaddr, max_align, vaddr - offset)
			}

			/// Choose the offset, address, and alignment of a new loadable segment at the end of the
			/// file. It goes after every address the image already occupies, and the same distance from
			/// its offset as the rest of the image, because a kernel before 5.19 reports the program
			/// header table at the load address plus `e_phoff` rather than at the address of the
			/// segment holding it. Both computations agree only when every segment keeps the same
			/// distance.
			fn appended_segment(&self, file: &File, file_size: usize) -> (usize, usize, usize) {
				let (max_vaddr, max_align, bias) = self.image_extent(file);
				let offset = align(file_size.max(align(max_vaddr, max_align) - bias), max_align);

				// The segment is placed at the largest alignment in the image, but it can only claim
				// an alignment its own address and offset agree on, which an image loaded at an
				// unusual address may not.
				let mut segment_align = max_align;
				while bias % segment_align != 0 {
					segment_align /= 2;
				}
				(offset, offset + bias, segment_align)
			}

			/// Add the manifest in a new read-only segment at the end of the file. This is for images
			/// whose last loadable segment has a bss, which cannot be extended over file data without
			/// initializing memory that must stay zero-filled. The segment also holds a copy of the elf
			/// header and a program header table with room for itself, because the wrapper reads both
			/// from the addresses the kernel maps them at.
			fn append_manifest_segment(
				&self,
				file: &mut File,
				data: &[u8],
				mut section_table: Vec<u8>,
				name_index: usize,
			) {
				let ehdr_size = size_of::<paste! {[<$elf _Ehdr>]}>();
				let phdr_size = size_of::<paste! {[<$elf _Phdr>]}>();
				let shdr_size = size_of::<paste! {[<$elf _Shdr>]}>();
				let (phdr_offset, phdr_count) = {
					let ehdr = self.elf_header(file);
					(
						ehdr.e_phoff.to_usize().unwrap(),
						ehdr.e_phnum.to_usize().unwrap(),
					)
				};
				let new_phdr_count = phdr_count + 1;

				// The section table goes first, so that the manifest and its footer are the last bytes
				// of the file, and so of the segment.
				let file_size = file
					.file_size()
					.expect("failed to get the file size")
					.to_usize()
					.unwrap();
				let section_table_offset = align(file_size, align_of::<paste! {[<$elf _Shdr>]}>());
				let section_table_size = section_table.len() + shdr_size;
				let (segment_offset, segment_vaddr, segment_align) =
					self.appended_segment(file, section_table_offset + section_table_size);
				let headers_offset = segment_offset + ehdr_size;
				let new_section_offset = headers_offset + new_phdr_count * phdr_size;
				let segment_size = new_section_offset + data.len() - segment_offset;

				// Add the manifest section.
				let new_section_header = paste! {[<$elf _Shdr>] {
					sh_type: sys::SHT_NOTE,
					sh_offset: new_section_offset.try_into().unwrap(),
					sh_size: data.len().try_into().unwrap(),
					sh_addr: (segment_vaddr + new_section_offset - segment_offset)
						.try_into()
						.unwrap(),
					sh_name: name_index.try_into().unwrap(),
					sh_flags: sys::SHF_ALLOC.try_into().unwrap(),
					sh_link: 0,
					sh_info: 0,
					sh_addralign: 1,
					sh_entsize: 0,
				}};
				section_table.extend_from_slice(new_section_header.as_bytes());

				// Build the new program header table, moving PT_PHDR along with it.
				let new_segment = paste! {[<$elf _Phdr>] {
					p_type: sys::PT_LOAD,
					p_flags: sys::PF_R,
					p_offset: segment_offset.try_into().unwrap(),
					p_vaddr: segment_vaddr.try_into().unwrap(),
					p_paddr: segment_vaddr.try_into().unwrap(),
					p_filesz: segment_size.try_into().unwrap(),
					p_memsz: segment_size.try_into().unwrap(),
					p_align: segment_align.try_into().unwrap(),
				}};
				let mut phdr_bytes = Vec::with_capacity(new_phdr_count * phdr_size);
				let mut found_phdr = false;
				for index in 0..phdr_count {
					let offset = phdr_offset + index * phdr_size;
					let mut phdr = paste! {[<$elf _Phdr>]::read_from_bytes(
						&file[offset..offset + phdr_size],
					)}
					.expect("expected a program header");
					if phdr.p_type == sys::PT_PHDR {
						assert!(!found_phdr, "multiple program header segments found");
						found_phdr = true;
						let size = new_phdr_count * phdr_size;
						phdr.p_offset = headers_offset.try_into().unwrap();
						phdr.p_vaddr = (segment_vaddr + ehdr_size).try_into().unwrap();
						phdr.p_paddr = phdr.p_vaddr;
						phdr.p_filesz = size.try_into().unwrap();
						phdr.p_memsz = size.try_into().unwrap();
					}
					phdr_bytes.extend_from_slice(phdr.as_bytes());
				}

				// The new segment goes last, which keeps the loadable segments in address order
				// because it is above every address the image already occupies.
				phdr_bytes.extend_from_slice(new_segment.as_bytes());

				// Write the section table, then the segment.
				let padding = section_table_offset - file_size;
				if padding > 0 {
					file.append(&vec![0; padding])
						.expect("failed to align the section table");
				}
				file.append(&section_table)
					.expect("failed to write the new section table to the file");
				let padding = segment_offset - section_table_offset - section_table_size;
				if padding > 0 {
					file.append(&vec![0; padding])
						.expect("failed to write segment padding");
				}
				let ehdr = self.elf_header_mut(file);
				ehdr.e_phoff = headers_offset.try_into().unwrap();
				ehdr.e_phnum = new_phdr_count.try_into().unwrap();
				ehdr.e_shnum += 1;
				ehdr.e_shoff = section_table_offset.try_into().unwrap();
				let ehdr_bytes = ehdr.as_bytes().to_vec();
				file.append(&ehdr_bytes)
					.expect("failed to write the copied elf header");
				file.append(&phdr_bytes)
					.expect("failed to write the relocated program header table");
				file.append(data)
					.expect("failed to write the manifest to the end of the file");
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

				// The whole ELF file is the blob that gets appended. The stub segment below maps it
				// at p_offset = wrapper_offset, p_vaddr = wrapper_vaddr, so the blob must be indexed
				// by file offset: an `objcopy -O binary` image is indexed by load address and faults
				// once execution leaves the first segment.
				let wrapper_exe = std::fs::read(&wrapper_exe_path)?;
				let wrapper_ehdr = paste! {[<$elf _Ehdr>]::read_from_bytes(
					&wrapper_exe[0..size_of::<[<$elf _Ehdr>]>()],
				)}
				.expect("expected an elf header");
				if wrapper_ehdr.e_type.to_u32() != Some(sys::ET_DYN) {
					return Err(std::io::Error::new(
						std::io::ErrorKind::InvalidInput,
						"the wrapper executable must be position-independent (ET_DYN)",
					));
				}
				let wrapper_entry_vaddr = wrapper_ehdr.e_entry.to_usize().unwrap();
				let wrapper_phdr_offset = wrapper_ehdr.e_phoff.to_usize().unwrap();
				let wrapper_phdr_count = wrapper_ehdr.e_phnum.to_usize().unwrap();
				let wrapper_entry_offset = (0..wrapper_phdr_count)
					.find_map(|index| {
						let offset = wrapper_phdr_offset + index * phdr_size;
						let bytes = wrapper_exe.get(offset..offset + phdr_size)?;
						let phdr = paste! {[<$elf _Phdr>]::read_from_bytes(bytes)}.ok()?;
						if phdr.p_type != sys::PT_LOAD {
							return None;
						}
						let vaddr = phdr.p_vaddr.to_usize().unwrap();
						let filesz = phdr.p_filesz.to_usize().unwrap();
						if wrapper_entry_vaddr < vaddr || wrapper_entry_vaddr >= vaddr + filesz {
							return None;
						}
						Some(phdr.p_offset.to_usize().unwrap() + wrapper_entry_vaddr - vaddr)
					})
					.ok_or_else(|| {
						std::io::Error::new(
							std::io::ErrorKind::InvalidInput,
							"the wrapper entry point is not in a file-backed PT_LOAD",
						)
					})?;

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

				// Find the PT_INTERP header and where a new segment can go.
				let mut pt_interp_index: Option<usize> = None;
				for i in 0..phdr_count {
					let off = phdr_offset + i * phdr_size;
					let phdr = paste! {[<$elf _Phdr>]::read_from_bytes(&file[off..off + phdr_size])}
						.expect("invalid program header");
					if phdr.p_type == sys::PT_INTERP {
						assert!(pt_interp_index.is_none(), "multiple interpreters found");
						pt_interp_index = Some(i);
					}
				}
				let (segment_offset, segment_vaddr, segment_align) =
					self.appended_segment(&file, file_size);

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

				// Compute the data layout. The footer is included so that the segment covers the same
				// bytes as the manifest section header, which counts it in its size.
				let wrapper_data_size =
					wrapper_exe.len() + manifest.len() + size_of::<crate::Footer>();

				// Determine the wrapper offset and address, and build a new phdr table if needed.
				let new_phdr_table: Option<(Vec<u8>, usize)>;
				let wrapper_offset: usize;
				let wrapper_vaddr: usize;

				if let Some(interpreter_index) = pt_interp_index {
					// Reuse PT_INTERP header for the stub segment. The existing program header table
					// stays where it is, so the kernel keeps mapping it and reporting it in AT_PHDR.
					assert_eq!(
						phdr_offset,
						size_of::<paste! {[<$elf _Ehdr>]}>(),
						"the program header table must follow the elf header",
					);
					wrapper_offset = segment_offset;
					wrapper_vaddr = segment_vaddr;
					new_phdr_table = None;

					let stub_segment = paste! {[<$elf _Phdr>] {
						p_type: sys::PT_LOAD,
						p_flags: sys::PF_R | sys::PF_X,
						p_offset: wrapper_offset.try_into().unwrap(),
						p_vaddr: wrapper_vaddr.try_into().unwrap(),
						p_paddr: wrapper_vaddr.try_into().unwrap(),
						p_filesz: wrapper_data_size.try_into().unwrap(),
						p_memsz: align(wrapper_data_size, segment_align).try_into().unwrap(),
						p_align: segment_align.try_into().unwrap(),
					}};
					let offset = phdr_offset + interpreter_index * phdr_size;
					file[offset..offset + phdr_size].copy_from_slice(stub_segment.as_bytes());
				} else {
					// Create a new program header table if there's no PT_INTERP we can abuse. It goes
					// inside the stub segment, preceded by a copy of the elf header, because the
					// wrapper reads both from the addresses the kernel maps them at.
					let new_count = phdr_count + 1;
					let headers_size = size_of::<paste! {[<$elf _Ehdr>]}>() + new_count * phdr_size;
					let stub_size = align(headers_size, segment_align) + wrapper_data_size;
					let headers_offset = segment_offset + size_of::<paste! {[<$elf _Ehdr>]}>();
					wrapper_offset = segment_offset + align(headers_size, segment_align);
					wrapper_vaddr = segment_vaddr + align(headers_size, segment_align);

					let stub_segment = paste! {[<$elf _Phdr>]{
						p_type: sys::PT_LOAD,
						p_flags: sys::PF_R | sys::PF_X,
						p_offset: segment_offset.try_into().unwrap(),
						p_vaddr: segment_vaddr.try_into().unwrap(),
						p_paddr: segment_vaddr.try_into().unwrap(),
						p_filesz: stub_size.try_into().unwrap(),
						p_memsz: align(stub_size, segment_align).try_into().unwrap(),
						p_align: segment_align.try_into().unwrap(),
					}};

					let mut bytes = Vec::with_capacity(new_count * phdr_size);
					let mut load_entries = Vec::new();

					// Collect all loadable segments, including the stub, and order them by address.
					for i in 0..phdr_count {
						let off = phdr_offset + i * phdr_size;
						let phdr = paste! {[<$elf _Phdr>]::read_from_bytes(&file[off..off + phdr_size])}.unwrap();
						assert!(phdr.p_type != sys::PT_PHDR, "unexpected PT_PHDR");
						if phdr.p_type == sys::PT_LOAD {
							load_entries.push(phdr);
						}
					}
					load_entries.push(stub_segment);
					load_entries.sort_unstable_by_key(|phdr| phdr.p_vaddr);
					for phdr in load_entries {
						bytes.extend_from_slice(phdr.as_bytes());
					}

					// Copy non-loadable segments.
					for i in 0..phdr_count {
						let off = phdr_offset + i * phdr_size;
						let phdr = paste! {[<$elf _Phdr>]::read_from_bytes(&file[off..off + phdr_size])}.unwrap();
						if phdr.p_type != sys::PT_LOAD {
							bytes.extend_from_slice(phdr.as_bytes());
						}
					}

					assert_eq!(bytes.len(), new_count * phdr_size);
					new_phdr_table = Some((bytes, headers_offset));
				}

				// Patch section headers.
				let mut wrapper_shdr = paste! {[<$elf _Shdr>]::read_from_bytes(
					&file[wrapper_shdr_offset..wrapper_shdr_offset + shdr_size],
				)}
				.unwrap();
				wrapper_shdr.sh_type = sys::SHT_PROGBITS;
				wrapper_shdr.sh_flags = (sys::SHF_ALLOC | sys::SHF_EXECINSTR).try_into().unwrap();
				wrapper_shdr.sh_addr = wrapper_vaddr.try_into().unwrap();
				wrapper_shdr.sh_offset = wrapper_offset.try_into().unwrap();
				wrapper_shdr.sh_size = wrapper_data_size.try_into().unwrap();
				wrapper_shdr.sh_link = 0;
				wrapper_shdr.sh_addralign = segment_align.try_into().unwrap();
				wrapper_shdr.sh_entsize = 0;
				file[wrapper_shdr_offset..wrapper_shdr_offset + shdr_size]
					.copy_from_slice(wrapper_shdr.as_bytes());

				let mut manifest_shdr = paste! {[<$elf _Shdr>]::read_from_bytes(
					&file[manifest_shdr_offset..manifest_shdr_offset + shdr_size],
				)}
				.unwrap();
				manifest_shdr.sh_type = sys::SHT_NOTE;
				manifest_shdr.sh_flags = sys::SHF_ALLOC.try_into().unwrap();
				manifest_shdr.sh_addr = (wrapper_vaddr + wrapper_exe.len()).try_into().unwrap();
				manifest_shdr.sh_offset = (wrapper_offset + wrapper_exe.len()).try_into().unwrap();
				manifest_shdr.sh_size =
					(manifest.len() + size_of::<crate::Footer>()).try_into().unwrap();
				manifest_shdr.sh_link = 0;
				manifest_shdr.sh_addralign = 1;
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
				ehdr.e_entry = (wrapper_vaddr + wrapper_entry_offset)
					.try_into()
					.unwrap();

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

				// Write new program header table if necessary, preceded by a copy of the patched elf
				// header, which is where the wrapper looks for it.
				if let Some((phdr_bytes, headers_offset)) = new_phdr_table {
					let ehdr_bytes = self.elf_header(&file).as_bytes().to_vec();
					let padding = headers_offset - ehdr_bytes.len() - file_size;
					if padding > 0 {
						file.append(&vec![0u8; padding])?;
					}
					file.append(&ehdr_bytes)?;
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

				// Append the wrapper executable.
				file.append(&wrapper_exe)?;

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

				// Get the section table, before the insert below moves it.
				let mut section_table = file[section_table_location].to_vec();

				// The name goes at the end of the string table, so its index is the old length.
				let name_index = string_table_location.length;

				// Update existing sections. Growing the string table in place shifts everything after
				// it along by the length of the name.
				let shift = <paste! {[<$elf _Off>]}>::try_from(name_len).unwrap();
				for (index, chunk) in section_table
					.chunks_exact_mut(size_of::<paste! {[<$elf _Shdr>]}>())
					.enumerate()
				{
					let header = paste! {[<$elf _Shdr>]::mut_from_bytes(chunk)}
						.expect("expected a section header");
					if index == string_table_index {
						header.sh_size += shift;
						continue;
					}
					if header.sh_offset >= string_table_location.end().try_into().unwrap() {
						header.sh_offset += shift;
					}
				}

				// Append the name to the string table.
				file.insert(name, string_table_location.end().to_u64().unwrap())
					.expect("failed to insert string table");

				// Delete the old section table, which the insert may have moved.
				if section_table_location.offset >= string_table_location.end() {
					section_table_location.offset += name_len;
				}
				file.delete(section_table_location)
					.expect("failed to delete section table");

				// Get the segment the manifest will be added to, and the distance between its
				// addresses and its offsets.
				let phdr_size = size_of::<paste! {[<$elf _Phdr>]}>();
				let segment_offset = self
					.last_loadable_segment(file)
					.expect("expected a loadable segment");
				let segment =
					paste! {[<$elf _Phdr>]::read_from_bytes(&file[segment_offset..segment_offset + phdr_size])}
						.expect("expected a program header");
				assert!(
					segment.p_filesz <= segment.p_memsz,
					"segment file size exceeds its memory size",
				);

				// Extending a segment with a BSS would make the bytes after p_filesz initialize
				// memory which must remain zero-filled, so give the manifest a segment of its own.
				if segment.p_filesz < segment.p_memsz {
					self.append_manifest_segment(file, data, section_table, name_index);
					return;
				}
				let vaddr_delta =
					segment.p_vaddr.to_usize().unwrap() - segment.p_offset.to_usize().unwrap();

				// The section table is written before the manifest, so that the manifest and its
				// footer are the last bytes of the file, and so of the segment extended below.
				let section_table_offset = file.file_size().expect("failed to get the file size");
				let new_section_offset = section_table_offset.to_usize().unwrap()
					+ section_table.len()
					+ size_of::<paste! {[<$elf _Shdr>]}>();

				// Create the new section. It is allocated, so that a tool which repacks the file keeps
				// it inside the segment extended below rather than moving it out with the other
				// sections that are not part of the image.
				let new_section_header = paste! {[<$elf _Shdr>]{
					sh_type: sys::SHT_NOTE,
					sh_offset: new_section_offset .try_into().unwrap(),
					sh_size: data.len() .try_into().unwrap(),
					sh_addr: (new_section_offset + vaddr_delta) .try_into().unwrap(),
					sh_name: name_index .try_into().unwrap(),
					sh_flags: sys::SHF_ALLOC .try_into().unwrap(),
					sh_link: 0,
					sh_info: 0,
					sh_addralign: 1,
					sh_entsize: 0,
				}};

				// Write the new section to the section table.
				section_table.extend_from_slice(new_section_header.as_bytes());

				// Append the new section table.
				file.append(&section_table)
					.expect("failed to write the new section table to the file");

				// Write the new section.
				file.append(data)
					.expect("failed to write new section to end of file");

				// Extend the segment so that the kernel maps the manifest.
				let file_size = file.file_size().expect("failed to get the file size");
				let segment =
					paste! {[<$elf _Phdr>]::mut_from_bytes(&mut file[segment_offset..segment_offset + phdr_size])}
						.expect("expected a program header");
				let filesz = file_size.to_usize().unwrap() - segment.p_offset.to_usize().unwrap();
				segment.p_filesz = filesz.try_into().unwrap();
				segment.p_memsz = filesz.try_into().unwrap();

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

				// Update the segment containing the manifest, so that its file size continues to
				// cover the whole manifest and footer.
				let phdr_size = size_of::<paste! {[<$elf _Phdr>]}>();
				let (phdr_offset, phdr_count) = {
					let ehdr = self.elf_header(file);
					(
						ehdr.e_phoff.to_usize().unwrap(),
						ehdr.e_phnum.to_usize().unwrap(),
					)
				};
				for i in 0..phdr_count {
					let off = phdr_offset + i * phdr_size;
					let phdr = paste! {[<$elf _Phdr>]::mut_from_bytes(&mut file[off..off + phdr_size])}
						.expect("expected a program header");
					if phdr.p_type != sys::PT_LOAD {
						continue;
					}
					let start = phdr.p_offset.to_usize().unwrap();
					let end = start + phdr.p_filesz.to_usize().unwrap();
					if old.offset >= start && old.offset < end {
						let new_filesz = isize::try_from(phdr.p_filesz).unwrap() + diff;
						let new_filesz = usize::try_from(new_filesz).unwrap();
						phdr.p_filesz = new_filesz.try_into().unwrap();
						phdr.p_memsz = phdr.p_memsz.max(new_filesz.try_into().unwrap());
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

#[cfg(all(
	test,
	target_os = "linux",
	target_endian = "little",
	target_pointer_width = "64"
))]
mod tests {
	use super::*;
	use std::sync::atomic::{AtomicU8, Ordering};

	const CHILD_ENV: &str = "TANGRAM_WRAP_BSS_TEST_CHILD";

	#[used]
	static RETAINED_BSS: [AtomicU8; 65_536] = [const { AtomicU8::new(0) }; 65_536];

	fn retained_bss_is_zero() -> bool {
		RETAINED_BSS[0].load(Ordering::Relaxed) == 0
			&& RETAINED_BSS[RETAINED_BSS.len() - 1].load(Ordering::Relaxed) == 0
	}

	fn last_loadable_segment(file: &File) -> Elf64_Phdr {
		let offset = Elf64
			.last_loadable_segment(file)
			.expect("expected a loadable segment");
		Elf64_Phdr::read_from_bytes(&file[offset..offset + size_of::<Elf64_Phdr>()])
			.expect("expected a program header")
	}

	#[test]
	fn writes_manifest_to_elf_with_bss() {
		if std::env::var_os(CHILD_ENV).is_some() {
			assert!(retained_bss_is_zero());
			return;
		}

		assert!(retained_bss_is_zero());
		let executable = std::env::current_exe().expect("failed to get the test executable");
		let original = File::open(&executable, true).expect("failed to open the test executable");
		let original_phnum = Elf64.elf_header(&original).e_phnum;
		let bss_segment = last_loadable_segment(&original);
		assert!(bss_segment.p_memsz > bss_segment.p_filesz);
		drop(original);

		let temp = tempfile::tempdir().expect("failed to create a temporary directory");
		let rewritten_path = temp.path().join("wrap-bss-test");
		std::fs::copy(&executable, &rewritten_path).expect("failed to copy the test executable");
		let first_manifest = serde_json::json!({ "bss": true });
		crate::write_manifest(&rewritten_path, &first_manifest, None);
		let output = crate::read_manifest::<serde_json::Value>(&rewritten_path, None);
		assert_eq!(output.manifest, Some(first_manifest));

		let manifest = serde_json::json!({ "bss": true, "padding": "x".repeat(8_192) });
		crate::write_manifest(&rewritten_path, &manifest, None);
		let output = crate::read_manifest::<serde_json::Value>(&rewritten_path, None);
		assert_eq!(output.manifest, Some(manifest));
		let rewritten =
			File::open(&rewritten_path, true).expect("failed to open the rewritten file");
		let ehdr = Elf64.elf_header(&rewritten);
		assert_eq!(ehdr.e_phnum, original_phnum + 1);
		let manifest_location = output.location.expect("expected a manifest location");
		let phdr_size = size_of::<Elf64_Phdr>();
		let mut found_original_bss = false;
		let mut found_manifest_segment = false;
		for index in 0..ehdr.e_phnum.to_usize().unwrap() {
			let offset = ehdr.e_phoff.to_usize().unwrap() + index * phdr_size;
			let phdr = Elf64_Phdr::read_from_bytes(&rewritten[offset..offset + phdr_size])
				.expect("expected a program header");
			if phdr.p_type != sys::PT_LOAD {
				continue;
			}
			if phdr.p_vaddr == bss_segment.p_vaddr {
				assert_eq!(phdr.p_offset, bss_segment.p_offset);
				assert_eq!(phdr.p_filesz, bss_segment.p_filesz);
				assert_eq!(phdr.p_memsz, bss_segment.p_memsz);
				found_original_bss = true;
			}
			let start = phdr.p_offset.to_usize().unwrap();
			let end = start + phdr.p_filesz.to_usize().unwrap();
			if manifest_location.offset >= start && manifest_location.end() == end {
				assert_eq!(phdr.p_filesz, phdr.p_memsz);
				found_manifest_segment = true;
			}
		}
		assert!(found_original_bss);
		assert!(found_manifest_segment);
		drop(rewritten);

		let child = std::process::Command::new(&rewritten_path)
			.args(["--exact", "elf::tests::writes_manifest_to_elf_with_bss"])
			.env(CHILD_ENV, "1")
			.output()
			.expect("failed to execute the rewritten test executable");
		assert!(
			child.status.success(),
			"rewritten executable failed with status {:?}\nstdout:\n{}\nstderr:\n{}",
			child.status.code(),
			String::from_utf8_lossy(&child.stdout),
			String::from_utf8_lossy(&child.stderr),
		);
	}
}
