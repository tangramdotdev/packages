use super::{check_libc_result, write_to_stderr};
use libc::{c_char, exit, getenv, malloc, memcpy, setenv, strcpy, strlen, strnlen, unsetenv};

/// The path to return from `_NSGetExecutablePath`.
#[no_mangle]
pub static mut IDENTITY_PATH: *mut c_char = core::ptr::null_mut();

/// Initialize the identity injection path and environment.
#[no_mangle]
pub extern "C" fn tangram_injection() {
	unsafe {
		// Reset $DYLD_LIBRARY_PATH
		let dyld_library_path_varname = c"DYLD_LIBRARY_PATH";
		let injection_dyld_library_path_varname = c"TANGRAM_INJECTION_DYLD_LIBRARY_PATH";

		let dyld_library_path = getenv(injection_dyld_library_path_varname.as_ptr());
		if dyld_library_path.is_null() {
			let result = unsetenv(dyld_library_path_varname.as_ptr());
			check_libc_result(result, c"Failed to unset $DYLD_LIBRARY_PATH.\n");
		} else {
			let result = setenv(dyld_library_path_varname.as_ptr(), dyld_library_path, 1);
			check_libc_result(result, c"Failed to set $DYLD_LIBRARY_PATH.\n");
		}
		let result = unsetenv(injection_dyld_library_path_varname.as_ptr());
		check_libc_result(
			result,
			c"Failed to unset $TANGRAM_INJECTION_DYLD_LIBRARY_PATH.\n",
		);

		// Reset $DYLD_INSERT_LIBRARIES
		let dyld_insert_libraries_varname = c"DYLD_INSERT_LIBRARIES";
		let injection_dyld_insert_libraries_varname = c"TANGRAM_INJECTION_DYLD_INSERT_LIBRARIES";

		let dyld_insert_libraries = getenv(injection_dyld_insert_libraries_varname.as_ptr());
		if dyld_insert_libraries.is_null() {
			let result = unsetenv(dyld_insert_libraries_varname.as_ptr());
			check_libc_result(result, c"Failed to unset $DYLD_INSERT_LIBRARIES.\n");
		} else {
			let result = setenv(
				dyld_insert_libraries_varname.as_ptr(),
				dyld_insert_libraries,
				1,
			);
			check_libc_result(result, c"Failed to set $DYLD_INSERT_LIBRARIES.\n");
		}
		let result = unsetenv(injection_dyld_insert_libraries_varname.as_ptr());
		check_libc_result(
			result,
			c"Failed to unset $TANGRAM_INJECTION_DYLD_INSERT_LIBRARIES.\n",
		);

		// Set the identity path
		let tangram_identity_path_varname = c"TANGRAM_INJECTION_IDENTITY_PATH";
		let identity_path_value = getenv(tangram_identity_path_varname.as_ptr());
		if identity_path_value.is_null() {
			write_to_stderr(c"Error: TANGRAM_INJECTION_IDENTITY_PATH is not set.\n");
			exit(1);
		}

		// Copy the identity path.
		IDENTITY_PATH = malloc(strlen(identity_path_value) + 1).cast::<c_char>();
		let _ = strcpy(IDENTITY_PATH, identity_path_value);

		// Unset the injection identity path.
		let result = unsetenv(tangram_identity_path_varname.as_ptr());
		check_libc_result(
			result,
			c"Failed to unset $TANGRAM_INJECTION_IDENTITY_PATH.\n",
		);
	}
}

/// Set `tangram_injection` as the constructor function (emulating __attribute(constructor)).
#[used]
#[link_section = "__DATA,__mod_init_func"]
static CONSTRUCTOR: extern "C" fn() = tangram_injection;

/// Override `NSGetExecutablePath`. See <https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man3/dyld.3.html>.
#[no_mangle]
pub unsafe extern "C" fn _NSGetExecutablePath(buf: *mut c_char, bufsize: *mut u32) -> i32 {
	// Note: MAXPATHLEN in bytes is 255 UTF-8 characters plus the null terminator.
	let size = strnlen(IDENTITY_PATH, 255 * 4) + 1;
	let size = u32::try_from(size).expect("overflow");
	if *bufsize < size {
		*bufsize = size;
		return -1;
	}
	memcpy(buf.cast(), IDENTITY_PATH.cast(), size as usize);
	0
}
