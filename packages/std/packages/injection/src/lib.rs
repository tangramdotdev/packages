#![no_std]

use libc::{c_char, exit, size_t, STDERR_FILENO};

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "linux")]
pub use linux::*;
#[cfg(target_os = "macos")]
pub use macos::*;

/// Utility function to write a message to stderr.
fn write_to_stderr(message: impl AsRef<core::ffi::CStr>) {
	let message = message.as_ref().to_bytes_with_nul();
	let buf = message.as_ptr().cast::<c_char>();
	let len = message.len() as size_t;
	let result = unsafe { libc::write(STDERR_FILENO, buf.cast(), len) };

	let len: isize = len
		.try_into()
		.expect("Conversion from usize to isize failed");

	if result != len {
		let error_message = c"Failed to write to stderr.\n";
		let len = core::mem::size_of_val(error_message) - 1;
		unsafe {
			libc::write(STDERR_FILENO, error_message.as_ptr().cast(), len);
			exit(1);
		}
	}
}

/// Utility function to check the result of a libc function and print an error message and exit if it failed.
fn check_libc_result(result: libc::c_int, error_message: impl AsRef<core::ffi::CStr>) {
	if result != 0 {
		write_to_stderr(error_message);
		unsafe {
			exit(result);
		}
	}
}

#[cfg(not(test))]
#[panic_handler]
fn panic(_info: &core::panic::PanicInfo) -> ! {
	loop {}
}
