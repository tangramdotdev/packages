#![no_std]

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;

mod util;

#[cfg(target_os = "linux")]
pub use linux::*;
#[cfg(target_os = "macos")]
pub use macos::*;

/// The path to use as the self-identity for the process.
pub(crate) static IDENTITY_PATH: spin::Once<&core::ffi::CStr> = spin::Once::new();

pub(crate) fn initialize_identity_path() {
	unsafe {
		IDENTITY_PATH.call_once(|| {
			let tangram_identity_path_varname = c"TANGRAM_INJECTION_IDENTITY_PATH";
			let identity_path_value_ptr = libc::getenv(tangram_identity_path_varname.as_ptr());
			if identity_path_value_ptr.is_null() {
				util::log_stderr(c"Error: TANGRAM_INJECTION_IDENTITY_PATH is not set.");
				libc::exit(libc::EXIT_FAILURE);
			}
			// Convert the identity path.
			let identity_path = core::ffi::CStr::from_ptr(identity_path_value_ptr);

			// Unset the injection identity path.
			expect_success_unsafe!(
				libc::unsetenv(tangram_identity_path_varname.as_ptr()),
				c"unsetenv $TANGRAM_INJECTION_IDENTITY_PATH"
			);

			identity_path
		});
	}
}

/// Unused panic handler for `no_std`.
#[cfg(not(test))]
#[panic_handler]
fn panic(_info: &core::panic::PanicInfo) -> ! {
	loop {}
}
