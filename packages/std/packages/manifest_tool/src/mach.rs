use crate::{BinaryFormat, File, FileLocation, Footer, MAGIC};
use num::ToPrimitive as _;
use sys::{
	LC_CODE_SIGNATURE, LC_SEGMENT_64, linkedit_data_command, load_command, mach_header_64,
	segment_command_64,
};

#[allow(warnings, clippy::pedantic, clippy::all)]
pub(crate) mod sys;

pub struct Mach64;

pub struct MachUniversal;

const LINKEDIT: [u8; 16] = [
	b'_', b'_', b'L', b'I', b'N', b'K', b'E', b'D', b'I', b'T', 0, 0, 0, 0, 0, 0,
];

const MAGIC_64: u32 = 0xfeed_facf;
const MAGIC_UNIVERSAL: u32 = 0xcafe_babe;
const ALIGNMENT: usize = 16;

impl BinaryFormat for Mach64 {
	fn matches(&self, file: &crate::file::File) -> bool {
		let magic = u32::from_le_bytes(file[0..4].try_into().unwrap());
		magic == MAGIC_64
	}

	#[allow(clippy::unused_self)]
	fn name(&self) -> &'static str {
		"mach"
	}

	fn write_manifest(&self, file: &mut File, data: &[u8]) {
		// Get the data and pad to 4 byte boundaries.
		let mut data = data.to_vec();

		// Pad to 4 byte boundaries.
		if !data.len().is_multiple_of(ALIGNMENT) {
			let padding = ALIGNMENT - data.len() % ALIGNMENT;
			for _ in 0..padding {
				data.insert(0, 0);
			}
		}

		// Find the code signature and LINKEDIT sections.
		let mut code_signature_command = None;
		let mut linkedit_command = None;
		let header = file.read_at::<mach_header_64>(0);
		let mut offset = size_of_val(header);
		for _ in 0..header.ncmds {
			let load_command = file.read_at::<load_command>(offset);
			if load_command.cmd == LC_CODE_SIGNATURE {
				assert!(code_signature_command.is_none());
				let command = *file.read_at::<linkedit_data_command>(offset);
				code_signature_command.replace((offset, command));
			}
			if load_command.cmd == LC_SEGMENT_64 {
				let command = file.read_at::<segment_command_64>(offset);
				if command.segname == LINKEDIT {
					assert!(linkedit_command.is_none());
					linkedit_command.replace(offset);
				}
			}
			offset += load_command.cmdsize.to_usize().unwrap();
		}

		// Insert the data.
		let position = code_signature_command.map_or_else(
			|| file.file_size().unwrap(),
			|(_, command)| command.dataoff.into(),
		);

		// Patch LINKEDIT
		if let Some(offset) = linkedit_command {
			let command = file.read_at_mut::<segment_command_64>(offset);
			command.filesize += data.len().to_u64().unwrap();
		}

		// Patch the code signature.
		if let Some((offset, _)) = code_signature_command {
			let command = file.read_at_mut::<linkedit_data_command>(offset);
			command.dataoff += data.len().to_u32().unwrap();
		}
		file.insert(&data, position).expect("failed to insert data");
	}

	fn read_manifest(&self, file: &File) -> Option<crate::FileLocation> {
		// Find the code signature.
		let mut code_signature_command = None;
		let header = *file.read_at::<mach_header_64>(0);
		let mut offset = size_of::<mach_header_64>();
		for _ in 0..header.ncmds {
			let load_command = file.read_at::<load_command>(offset);
			if load_command.cmd == LC_CODE_SIGNATURE {
				let command = file.read_at::<linkedit_data_command>(offset);
				code_signature_command.replace(command.dataoff.to_usize().unwrap());
				break;
			}
			offset += load_command.cmdsize.to_usize().unwrap();
		}
		let offset = code_signature_command? - size_of::<Footer>();

		// Try and find the magic number within about
		let footer = file.read_at_unaligned::<Footer>(offset);
		if footer.magic != MAGIC {
			return None;
		}
		let offset = offset
			.checked_sub(footer.size.try_into().unwrap())
			.expect("underflow");
		let length = footer.size.to_usize().unwrap() + size_of::<Footer>();
		Some(crate::FileLocation { offset, length })
	}

	fn overwrite_manifest(&self, file: &mut File, data: &[u8]) {
		let Some(old) = self.read_manifest(file) else {
			self.write_manifest(file, data);
			return;
		};

		// Compute the new offset of the code signature.
		let new_offset = old.offset.to_usize().unwrap() + data.len();

		// Find the code signature.
		let header = *file.read_at::<mach_header_64>(0);
		let mut offset = size_of_val(&header);
		for _ in 0..header.ncmds {
			let load_command = *file.read_at::<load_command>(offset);
			if load_command.cmd == LC_CODE_SIGNATURE {
				let code_signature = file.read_at_mut::<linkedit_data_command>(offset);
				code_signature.dataoff = new_offset.try_into().unwrap();
				break;
			}
			offset += load_command.cmdsize.to_usize().unwrap();
		}

		// Replace the manifest.
		file.replace(old, data)
			.expect("failed to overwrite manifest");
	}
}

impl BinaryFormat for MachUniversal {
	fn matches(&self, file: &File) -> bool {
		let magic = u32::from_be_bytes(file[0..4].try_into().unwrap());
		magic == MAGIC_UNIVERSAL
	}

	fn name(&self) -> &'static str {
		"universal mach-o"
	}

	fn read_manifest(&self, file: &File) -> Option<FileLocation> {
		let file_size = file.file_size().expect("failed to get the file size");
		let offset = file_size.checked_sub(size_of::<Footer>().to_u64().unwrap())?;
		let footer = file.read_at::<Footer>(offset);
		if footer.magic != MAGIC {
			return None;
		}
		Some(FileLocation {
			offset: (offset - footer.size).to_usize().unwrap(),
			length: (file_size - offset).to_usize().unwrap(),
		})
	}

	fn write_manifest(&self, file: &mut File, data: &[u8]) {
		file.append(data).expect("failed to append data");
	}

	fn overwrite_manifest(&self, file: &mut File, data: &[u8]) {
		if let Some(old) = self.read_manifest(file) {
			file.delete(old).expect("failed to remove manifest");
		}
		self.write_manifest(file, data);
	}
}
