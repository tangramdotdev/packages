use super::{check_libc_result, write_to_stderr};
use libc::{c_char, exit, getenv, malloc, setenv, strcpy, strlen, unsetenv};

/// The path to return from `_NSGetExecutablePath`.
// FIXME use lazy_static
#[no_mangle]
pub static mut IDENTITY_PATH: *mut c_char = core::ptr::null_mut();
