use crate::{BinaryFormat, File, FileLocation, Options, SectionKind};
use std::{
	ffi::CStr,
	io::{Cursor, Read, Seek},
};
#[allow(nonstandard_style, dead_code)]
mod sys;
use sys::*;
use zerocopy::{FromBytes, FromZeros, IntoBytes};

#[derive(Default)]
pub struct Mach;

impl Mach {
	fn header<'a>(&self, file: &'a File) -> &'a mach_header_64 {
		mach_header_64::ref_from_bytes(&file[0..size_of::<mach_header_64>()])
			.expect("expected a header")
	}

	fn header_mut<'a>(&self, file: &'a mut File) -> &'a mut mach_header_64 {
		mach_header_64::mut_from_bytes(&mut file[0..size_of::<mach_header_64>()])
			.expect("expected a header")
	}
}

impl BinaryFormat for Mach {
	fn matches(&self, file: &crate::file::File) -> bool {
		u32::from_ne_bytes(file[0..4].try_into().unwrap()) == MH_MAGIC_64
	}

	fn name(&self) -> &str {
		"mach"
	}

	fn add_section(&self, file: &mut File, options: Options<'_>) {
		assert!(matches!(options.kind, SectionKind::Note));
		assert!(options.name.len() < 16);
		let header = *self.header(file);

		// Look for a hole.
		let mut min_file_offset: Option<u64> = None;

		// Iterate the load commands and find
		let load_command_location = FileLocation {
			offset: size_of::<mach_header_64>(),
			length: header.sizeofcmds as _,
		};
		let mut cursor = Cursor::new(&file[load_command_location]);
		loop {
			// Read the load command.
			let mut load_command = load_command::new_zeroed();
			if cursor.read_exact(load_command.as_mut_bytes()).is_err() {
				break;
			}
			cursor
				.seek_relative(-(size_of::<load_command>() as i64))
				.unwrap();

			// Ignore non-segment commands.
			if load_command.cmd != LC_SEGMENT_64 {
				cursor.seek_relative(load_command.cmdsize as _).unwrap();
				continue;
			}

			// Get the segment command.
			let mut segment_command = segment_command_64::new_zeroed();
			cursor.read_exact(segment_command.as_mut_bytes()).unwrap();

			// Check the minimum file offset.
			match &mut min_file_offset {
				Some(existing) => {
					*existing = (*existing).min(segment_command.fileoff);
				},
				None => {
					min_file_offset.replace(segment_command.fileoff);
				},
			}

			// Advance.
			cursor
				.seek_relative(
					(segment_command.cmdsize as usize - size_of::<segment_command_64>()) as i64,
				)
				.unwrap();
		}

		if let Some(min_file_offset) = min_file_offset
			&& min_file_offset >= (size_of::<note_command>() as u64)
		{
			// Find the end of the file.
			let position = file.file_size().expect("failed to get the file size");

			// Append our data to the end of the file.
			file.append(&options.section)
				.expect("failed to write section to end of file");

			// Write our note command into the padding.
			let mut data_owner = [0; 16];
			data_owner[0..options.name.len()].copy_from_slice(options.name.as_bytes());
			let command = note_command {
				cmd: LC_NOTE,
				cmdsize: size_of::<note_command>() as _,
				data_owner,
				offset: position,
				size: options.section.len() as _,
			};
			let location = FileLocation {
				offset: header.sizeofcmds as usize,
				length: size_of::<note_command>(),
			};
			file[location].copy_from_slice(command.as_bytes());
			let header = self.header_mut(file);
			header.sizeofcmds += size_of::<note_command>() as u32;
			header.ncmds += 1;
		}

		todo!("handle case where we need to move segments");
	}

	fn find_section(&self, file: &crate::file::File, name: &str) -> Option<crate::FileLocation> {
		let header = self.header(file);
		let location = FileLocation {
			offset: size_of::<mach_header_64>(),
			length: header.sizeofcmds as _,
		};
		let mut cursor = Cursor::new(&file[location]);
		loop {
			let mut note_command = note_command::new_zeroed();
			if cursor.read_exact(&mut note_command.as_mut_bytes()).is_err() {
				break;
			}
			if note_command.cmd != LC_NOTE {
				continue;
			}
			let owner = CStr::from_bytes_until_nul(&note_command.data_owner)
				.ok()
				.and_then(|owner| owner.to_str().ok());
			if owner == Some(name) {
				let location = FileLocation {
					offset: note_command.offset as _,
					length: note_command.size as _,
				};
				return Some(location);
			}
		}
		None
	}
}
