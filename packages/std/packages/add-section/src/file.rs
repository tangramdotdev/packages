use crate::FileLocation;
use rustix::mm::{MapFlags, ProtFlags};
use std::{
	ops::{Deref, DerefMut},
	os::{
		raw::c_void,
		unix::fs::{FileExt as _, MetadataExt as _},
	},
	path::Path,
};

pub struct File {
	file: std::fs::File,
	data: *mut c_void,
	len: u64,
}

impl File {
	pub(crate) fn open(path: impl AsRef<Path>) -> std::io::Result<Self> {
		let file = std::fs::OpenOptions::new()
			.read(true)
			.write(true)
			.open(path)?;
		let mut file = Self {
			file,
			data: std::ptr::null_mut(),
			len: 0,
		};

		file.mmap()?;

		Ok(file)
	}

	pub(crate) fn delete(&mut self, location: FileLocation) -> std::io::Result<()> {
		self.munmap()?;
		let len = self.file.metadata()?.len();

		// Read the range of bytes from the end of the file
		let position = location.end() as u64;
		let mut buf = vec![0u8; (len - position) as usize];
		self.file.read_exact_at(&mut buf, position)?;

		// Write the bytes.
		self.file.write_all_at(&buf, location.offset as u64)?;

		// Truncate the file.
		self.file.set_len(len - location.length as u64)?;

		// Map the file again.
		self.mmap()?;
		Ok(())
	}

	pub fn insert(&mut self, bytes: &[u8], position: u64) -> std::io::Result<()> {
		// Unmap the file.
		self.munmap()?;

		// Get its length.
		let len = self.file.metadata()?.len();

		// Read the range of bytes from the end of the file
		let mut buf = vec![0u8; (len - position) as usize];
		self.file.read_exact_at(&mut buf, position)?;

		// Insert the new data.
		self.file.write_all_at(bytes, position)?;

		// Write the old data.
		self.file
			.write_all_at(&buf, position + bytes.len() as u64)?;

		// Re-map the file.
		self.mmap()?;
		Ok(())
	}

	pub fn append(&mut self, bytes: &[u8]) -> std::io::Result<()> {
		self.munmap()?;
		let len = self.file.metadata()?.len();
		self.file.write_at(bytes, len)?;
		self.mmap()?;
		Ok(())
	}

	pub fn file_size(&self) -> std::io::Result<u64> {
		self.file.metadata().map(|meta| meta.size())
	}

	fn mmap(&mut self) -> std::io::Result<()> {
		debug_assert!(self.data.is_null());
		self.len = dbg!(align(dbg!(self.file.metadata()?.size()), 4096));
		let prot = ProtFlags::READ | ProtFlags::WRITE;
		let flags = MapFlags::SHARED;
		self.data = unsafe {
			rustix::mm::mmap(
				std::ptr::null_mut(),
				self.len as _,
				prot,
				flags,
				&self.file,
				0,
			)?
		};
		Ok(())
	}

	fn munmap(&mut self) -> std::io::Result<()> {
		debug_assert!(!self.data.is_null());
		unsafe {
			rustix::mm::munmap(self.data, self.len as _)?;
		}
		self.data = std::ptr::null_mut();
		self.len = 0;
		Ok(())
	}
}

impl Deref for File {
	type Target = [u8];
	fn deref(&self) -> &Self::Target {
		if self.len == 0 {
			return &[];
		}
		unsafe { std::slice::from_raw_parts(self.data.cast(), self.len as _) }
	}
}

impl DerefMut for File {
	fn deref_mut(&mut self) -> &mut Self::Target {
		if self.len == 0 {
			return &mut [];
		}
		unsafe { std::slice::from_raw_parts_mut(self.data.cast(), self.len as _) }
	}
}

fn align(m: u64, n: u64) -> u64 {
	(m + n - 1) & !(n - 1)
}
