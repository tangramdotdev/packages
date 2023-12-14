#if !defined(__APPLE__)
	#error This library can only be built for macOS.
#endif

#include <stdlib.h>
#include <stdbool.h>
#include <string.h>
#include <stdio.h>

__attribute__((constructor))
void tangram_injection() {
	// Reset `$DYLD_LIBRARY_PATH`.
	char* dyld_library_path = getenv("TANGRAM_INJECTION_DYLD_LIBRARY_PATH");
	if (dyld_library_path) {
		setenv("DYLD_LIBRARY_PATH", dyld_library_path, true);
	} else {
		unsetenv("DYLD_LIBRARY_PATH");
	}

	// Reset `$DYLD_INSERT_LIBRARIES`.
	char* dyld_insert_libraries = getenv("TANGRAM_INJECTION_DYLD_INSERT_LIBRARIES");
	if (dyld_insert_libraries) {
		setenv("DYLD_INSERT_LIBRARIES", dyld_insert_libraries, true);
	} else {
		unsetenv("DYLD_INSERT_LIBRARIES");
	}
}

// Return the value of `$TANGRAM_INJECTION_IDENTITY_PATH`.
static char* IDENTITY_PATH = NULL;
static char* identity_path() {
	if (IDENTITY_PATH == NULL) {
		char* value = getenv("TANGRAM_INJECTION_IDENTITY_PATH");
		if (value == NULL) {
			fprintf(stderr, "Error: TANGRAM_INJECTION_IDENTITY_PATH is not set.\n");
			exit(1);
		}
		IDENTITY_PATH = (char*)malloc(strlen(value) + 1);
		strcpy(IDENTITY_PATH, value);
	}
	return IDENTITY_PATH;
}

// Override `NSGetExecutablePath`. See <https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man3/dyld.3.html>.
int32_t _NSGetExecutablePath (char* buf, uint32_t* bufsize) {
	// Note: MAXPATHLEN in bytes is 255 UTF-8 characters plus the null terminator.
	uint32_t size = strnlen(identity_path(), 255 * 4) + 1;
	if (*bufsize < size) {
		*bufsize = size;
		return -1;
	}
	memcpy(buf, identity_path(), size);
	return 0;
}
