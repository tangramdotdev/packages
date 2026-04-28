use crate::FileLocation;
use num::ToPrimitive as _;
use rustix::mm::{MapFlags, ProtFlags};
use std::{
	cmp::Ordering,
	fmt::Debug,
	ops::{Deref, DerefMut},
	os::{
		raw::c_void,
		unix::fs::{FileExt as _, MetadataExt as _},
	},
	path::Path,
};
use zerocopy::{FromBytes, Immutable, IntoBytes, KnownLayout};

#[allow(clippy::struct_field_names)]
pub struct File {
	file: std::fs::File,
	readonly: bool,
	data: *mut c_void,
	len: u64,
}

impl File {
	pub(crate) fn open(path: impl AsRef<Path>, readonly: bool) -> std::io::Result<Self> {
		let file = std::fs::OpenOptions::new()
			.read(true)
			.write(!readonly)
			.open(path)?;
		let mut file = Self {
			file,
			readonly,
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
		let position = location.end().to_u64().unwrap();
		let mut buf = vec![0u8; (len - position).to_usize().unwrap()];
		self.file.read_exact_at(&mut buf, position)?;

		// Write the bytes.
		self.file
			.write_all_at(&buf, location.offset.to_u64().unwrap())?;

		// Truncate the file.
		self.file.set_len(len - location.length.to_u64().unwrap())?;

		// Map the file again.
		self.mmap()?;
		Ok(())
	}

	pub fn insert(&mut self, bytes: &[u8], position: u64) -> std::io::Result<()> {
		// Unmap the file.
		self.munmap()?;

		// Get its length.
		let len = self.file.metadata()?.len();

		// Check to make sure the position isn't past the end of the file.
		if position > len {
			return Err(std::io::Error::other("position past the end of the file"));
		}

		// Read the range of bytes from the end of the file
		let mut buf = vec![0u8; (len - position).try_into().unwrap()];
		self.file.read_exact_at(&mut buf, position)?;

		// Insert the new data.
		self.file.write_all_at(bytes, position)?;
		rustix::fs::fsync(&self.file)?;

		// Write the old data.
		self.file
			.write_all_at(&buf, position + bytes.len().to_u64().unwrap())?;

		// Re-map the file.
		self.mmap()?;
		Ok(())
	}

	pub fn append(&mut self, bytes: &[u8]) -> std::io::Result<()> {
		self.munmap()?;
		let len = self.file.metadata()?.len();
		self.file.write_at(bytes, len)?;
		rustix::fs::fsync(&self.file)?;
		self.mmap()?;
		Ok(())
	}

	pub fn replace(&mut self, location: FileLocation, bytes: &[u8]) -> std::io::Result<()> {
		let range = location.range();
		let original_size: usize = self.file_size()?.try_into().unwrap();
		match range.len().cmp(&bytes.len()) {
			Ordering::Equal => {},
			Ordering::Greater => {
				self[range.start..(range.start + bytes.len())].copy_from_slice(bytes);
				self.copy_within(range.end..original_size, range.start + bytes.len());
				self.munmap()?;
				let diff = range.len() - bytes.len();
				let new_size = original_size - diff;
				self.file.set_len(new_size.try_into().unwrap())?;
				self.mmap()?;
			},
			Ordering::Less => {
				let diff = bytes.len() - range.len();
				let new_size = original_size + diff;
				self.munmap()?;
				self.file.set_len(new_size.try_into().unwrap())?;
				self.mmap()?;
				self.copy_within(range.end..original_size, range.end + diff);
				self[range.start..(range.start + bytes.len())].copy_from_slice(bytes);
			},
		}
		Ok(())
	}

	pub fn file_size(&self) -> std::io::Result<u64> {
		self.file.metadata().map(|meta| meta.size())
	}

	pub(crate) fn read_at<T>(&self, offset: impl TryInto<usize, Error: Debug>) -> &T
	where
		T: FromBytes + KnownLayout + Sized + Immutable,
	{
		let offset = offset.try_into().unwrap();
		T::ref_from_bytes(&self[offset..(offset + size_of::<T>())]).unwrap()
	}

	pub(crate) fn read_at_mut<T>(&mut self, offset: impl TryInto<usize, Error: Debug>) -> &'_ mut T
	where
		T: FromBytes + KnownLayout + Sized + Immutable + IntoBytes,
	{
		let offset = offset.try_into().unwrap();
		T::mut_from_bytes(&mut self[offset..(offset + size_of::<T>())]).unwrap()
	}

	pub(crate) fn read_at_unaligned<T>(&self, offset: impl TryInto<usize, Error: Debug>) -> T
	where
		T: FromBytes + KnownLayout + Sized + Immutable + IntoBytes,
	{
		let mut value = T::new_zeroed();
		let offset = offset.try_into().unwrap();
		let range = offset..(offset + size_of::<T>());
		value.as_mut_bytes().copy_from_slice(&self[range]);
		value
	}

	fn mmap(&mut self) -> std::io::Result<()> {
		assert!(self.data.is_null());
		self.len = align(self.file.metadata()?.size(), 4096);
		let mut prot = ProtFlags::READ;
		if !self.readonly {
			prot |= ProtFlags::WRITE;
		}
		let flags = MapFlags::SHARED;
		self.data = unsafe {
			rustix::mm::mmap(
				std::ptr::null_mut(),
				self.len.to_usize().unwrap(),
				prot,
				flags,
				&self.file,
				0,
			)?
		};
		Ok(())
	}

	fn munmap(&mut self) -> std::io::Result<()> {
		assert!(!self.data.is_null());
		unsafe {
			rustix::mm::munmap(self.data, self.len.to_usize().unwrap())?;
		}
		self.data = std::ptr::null_mut();
		self.len = 0;
		Ok(())
	}
}

impl Drop for File {
	fn drop(&mut self) {
		self.munmap().ok();
	}
}

impl Deref for File {
	type Target = [u8];
	fn deref(&self) -> &Self::Target {
		if self.len == 0 {
			return &[];
		}
		unsafe { std::slice::from_raw_parts(self.data.cast(), self.len.to_usize().unwrap()) }
	}
}

impl DerefMut for File {
	fn deref_mut(&mut self) -> &mut Self::Target {
		if self.len == 0 {
			return &mut [];
		}
		unsafe { std::slice::from_raw_parts_mut(self.data.cast(), self.len.to_usize().unwrap()) }
	}
}

fn align(m: u64, n: u64) -> u64 {
	(m + n - 1) & !(n - 1)
}
