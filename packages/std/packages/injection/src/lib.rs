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

/// The path to return from `_NSGetExecutablePath`.
// FIXME use lazy_static
#[no_mangle]
pub static mut IDENTITY_PATH: *mut libc::c_char = core::ptr::null_mut();

/// Unused panic handler for `no_std`.
#[cfg(not(test))]
#[panic_handler]
fn panic(_info: &core::panic::PanicInfo) -> ! {
	loop {}
}
