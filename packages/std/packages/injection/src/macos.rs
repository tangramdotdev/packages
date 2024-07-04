use crate::{expect_success_unsafe, IDENTITY_PATH};

/// Initialize the identity injection path and environment.
#[no_mangle]
pub extern "C" fn tangram_injection() {
	unsafe {
		// Reset $DYLD_LIBRARY_PATH
		let dyld_library_path_varname = c"DYLD_LIBRARY_PATH";
		let injection_dyld_library_path_varname = c"TANGRAM_INJECTION_DYLD_LIBRARY_PATH";

		let dyld_library_path = libc::getenv(injection_dyld_library_path_varname.as_ptr());
		if dyld_library_path.is_null() {
			expect_success_unsafe!(
				libc::unsetenv(dyld_library_path_varname.as_ptr()),
				c"unsetenv $DYLD_LIBRARY_PATH"
			);
		} else {
			expect_success_unsafe!(
				libc::setenv(dyld_library_path_varname.as_ptr(), dyld_library_path, 1),
				c"setenv $DYLD_LIBRARY_PATH"
			);
		}
		expect_success_unsafe!(
			libc::unsetenv(injection_dyld_library_path_varname.as_ptr()),
			c"unsetenv $TANGRAM_INJECTION_DYLD_LIBRARY_PATH"
		);

		// Reset $DYLD_INSERT_LIBRARIES
		let dyld_insert_libraries_varname = c"DYLD_INSERT_LIBRARIES";
		let injection_dyld_insert_libraries_varname = c"TANGRAM_INJECTION_DYLD_INSERT_LIBRARIES";

		let dyld_insert_libraries = libc::getenv(injection_dyld_insert_libraries_varname.as_ptr());
		if dyld_insert_libraries.is_null() {
			expect_success_unsafe!(
				libc::unsetenv(dyld_insert_libraries_varname.as_ptr()),
				c"unsetenv $DYLD_INSERT_LIBRARIES"
			);
		} else {
			expect_success_unsafe!(
				libc::setenv(
					dyld_insert_libraries_varname.as_ptr(),
					dyld_insert_libraries,
					1,
				),
				c"setenv $DYLD_INSERT_LIBRARIES"
			);
		}
		expect_success_unsafe!(
			libc::unsetenv(injection_dyld_insert_libraries_varname.as_ptr()),
			c"unsetenv $TANGRAM_INJECTION_DYLD_INSERT_LIBRARIES"
		);

		// Set the identity path
		crate::initialize_identity_path();
	}
}

/// Set `tangram_injection` as the constructor function (emulating __attribute(constructor)).
#[used]
#[link_section = "__DATA,__mod_init_func"]
static CONSTRUCTOR: extern "C" fn() = tangram_injection;

/// Override `NSGetExecutablePath`. See <https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man3/dyld.3.html>.
#[no_mangle]
pub unsafe extern "C" fn _NSGetExecutablePath(buf: *mut libc::c_char, bufsize: *mut u32) -> i32 {
	let identity_path = IDENTITY_PATH.wait().as_ptr();
	// Note: MAXPATHLEN in bytes is 255 UTF-8 characters plus the null terminator.
	let size = libc::strnlen(identity_path, 255 * 4) + 1;
	let size = u32::try_from(size).unwrap();
	if *bufsize < size {
		*bufsize = size;
		return -1;
	}
	libc::memcpy(buf.cast(), identity_path.cast(), size as usize);
	libc::EXIT_SUCCESS
}
