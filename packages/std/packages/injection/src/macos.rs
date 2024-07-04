use crate::{util, IDENTITY_PATH};

/// Initialize the identity injection path and environment.
#[no_mangle]
pub extern "C" fn tangram_injection() {
	unsafe {
		// Reset $DYLD_LIBRARY_PATH
		let dyld_library_path_varname = c"DYLD_LIBRARY_PATH";
		let injection_dyld_library_path_varname = c"TANGRAM_INJECTION_DYLD_LIBRARY_PATH";

		let dyld_library_path = libc::getenv(injection_dyld_library_path_varname.as_ptr());
		if dyld_library_path.is_null() {
			let result = libc::unsetenv(dyld_library_path_varname.as_ptr());
			util::expect_success(result, c"Failed to unset $DYLD_LIBRARY_PATH.");
		} else {
			let result = libc::setenv(dyld_library_path_varname.as_ptr(), dyld_library_path, 1);
			util::expect_success(result, c"Failed to set $DYLD_LIBRARY_PATH.");
		}
		let result = libc::unsetenv(injection_dyld_library_path_varname.as_ptr());
		util::expect_success(
			result,
			c"Failed to unset $TANGRAM_INJECTION_DYLD_LIBRARY_PATH.",
		);

		// Reset $DYLD_INSERT_LIBRARIES
		let dyld_insert_libraries_varname = c"DYLD_INSERT_LIBRARIES";
		let injection_dyld_insert_libraries_varname = c"TANGRAM_INJECTION_DYLD_INSERT_LIBRARIES";

		let dyld_insert_libraries = libc::getenv(injection_dyld_insert_libraries_varname.as_ptr());
		if dyld_insert_libraries.is_null() {
			let result = libc::unsetenv(dyld_insert_libraries_varname.as_ptr());
			util::expect_success(result, c"Failed to unset $DYLD_INSERT_LIBRARIES.");
		} else {
			let result = libc::setenv(
				dyld_insert_libraries_varname.as_ptr(),
				dyld_insert_libraries,
				1,
			);
			util::expect_success(result, c"Failed to set $DYLD_INSERT_LIBRARIES.");
		}
		let result = libc::unsetenv(injection_dyld_insert_libraries_varname.as_ptr());
		util::expect_success(
			result,
			c"Failed to unset $TANGRAM_INJECTION_DYLD_INSERT_LIBRARIES.",
		);

		// Set the identity path
		let tangram_identity_path_varname = c"TANGRAM_INJECTION_IDENTITY_PATH";
		let identity_path_value = libc::getenv(tangram_identity_path_varname.as_ptr());
		if identity_path_value.is_null() {
			util::log_error(c"Error: TANGRAM_INJECTION_IDENTITY_PATH is not set.");
			libc::exit(libc::EXIT_FAILURE);
		}

		// Copy the identity path.
		let identity_path_value_len = libc::strlen(identity_path_value) + 1;
		IDENTITY_PATH = libc::malloc(identity_path_value_len).cast::<libc::c_char>();
		let _ = libc::strcpy(IDENTITY_PATH, identity_path_value);

		// Unset the injection identity path.
		let result = libc::unsetenv(tangram_identity_path_varname.as_ptr());
		util::expect_success(
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
pub unsafe extern "C" fn _NSGetExecutablePath(buf: *mut libc::c_char, bufsize: *mut u32) -> i32 {
	// Note: MAXPATHLEN in bytes is 255 UTF-8 characters plus the null terminator.
	let size = libc::strnlen(IDENTITY_PATH, 255 * 4) + 1;
	let size = u32::try_from(size).unwrap();
	if *bufsize < size {
		*bufsize = size;
		return -1;
	}
	libc::memcpy(buf.cast(), IDENTITY_PATH.cast(), size as usize);
	libc::EXIT_SUCCESS
}
