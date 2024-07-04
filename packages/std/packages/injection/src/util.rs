/// Check the result of a libc function and print an error message and exit if it failed.
pub(crate) fn expect_success(result: libc::c_int, error_message: impl AsRef<core::ffi::CStr>) {
	if result != libc::EXIT_SUCCESS {
		log_error(error_message);
		unsafe {
			libc::exit(result);
		}
	}
}

/// Write a message to stderr with a trailing newline.
pub(crate) fn log_error(message: impl AsRef<core::ffi::CStr>) {
	// Obtain the message bytes.
	let message = message.as_ref().to_bytes_with_nul();
	let buf = message.as_ptr().cast::<libc::c_char>();
	let len = message.len() as libc::size_t;

	// Write the message.
	checked_writeln(
		libc::STDERR_FILENO,
		buf,
		len,
		c"Failed to write error message to stderr.\n",
	);
}

/// Call [`checked_write()`] with a trailing newline.
pub(crate) fn checked_writeln(
	fd: libc::c_int,
	buf: *const libc::c_char,
	count: usize,
	message: impl AsRef<core::ffi::CStr>,
) {
	checked_write(fd, buf, count, message);
	checked_write(fd, c"\n".as_ptr(), 2, c"Failed to write newline.\n");
}

/// Check the result of a [`libc::write()`] call. Prints the message to stderr and exits if the write failed.
pub(crate) fn checked_write(
	fd: libc::c_int,
	buf: *const libc::c_char,
	count: usize,
	message: impl AsRef<core::ffi::CStr>,
) {
	let result = unsafe { libc::write(fd, buf.cast(), count) };
	if result
		!= count
			.try_into()
			.expect("Conversion from usize to isize failed")
	{
		let error_message = message.as_ref().to_bytes_with_nul();
		let len = error_message.len() as libc::size_t;
		unsafe {
			libc::write(libc::STDERR_FILENO, error_message.as_ptr().cast(), len);
			libc::exit(libc::EXIT_FAILURE);
		}
	}
}
