#define _GNU_SOURCE

#include <dlfcn.h>
#include <linux/limits.h>
#include <sys/param.h>
#include <sys/stat.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static char* IDENTITY_PATH = NULL;

__attribute__((constructor))
void tangram_injection() {
	// Set the identity path.
	char* value = getenv("TANGRAM_INJECTION_IDENTITY_PATH");
	if (value == NULL) {
		fprintf(stderr, "Error: TANGRAM_INJECTION_IDENTITY_PATH is not set.\n");
		exit(1);
	}
	IDENTITY_PATH = (char*)malloc(strlen(value) + 1);
	strcpy(IDENTITY_PATH, value);
	unsetenv("TANGRAM_INJECTION_IDENTITY_PATH");
}

// Return true if `path` is "/proc/self/exe" or "/proc/$current_pid/exe".
static bool path_is_proc_self_exe(const char* path) {
	// Immediately bail on relative paths.
	if (path[0] != '/') {
		return false;
	}

	// Check if the path is "/proc/self/exe".
	if (strcmp(path, "/proc/self/exe") == 0) {
		return true;
	}

	// Check if the path is "/proc/$current_pid/exe".
	char path_with_pid[PATH_MAX];
	snprintf(path_with_pid, sizeof(path_with_pid), "/proc/%d/exe", getpid());
	if (strcmp(path, path_with_pid) == 0) {
		return true;
	}

	// Otherwise, it's a different path.
	return false;
}

/**
 * Write the value of `proc_self_exe_path()` into `buf` and return the number of bytes written. This function mimics the behavior of the `readlink` family of functions.
 *
 * Unlike `readlink`, the program will exit if an error is encountered. Any errors are assumed to be bugs in the implementation of this function.
 */
ssize_t proc_self_exe_readlink(char* buf, size_t bufsiz) {
	char* path = IDENTITY_PATH;
	size_t path_length = strlen(path);
	size_t copy_length = MIN(path_length, bufsiz);
	memcpy(buf, path, copy_length);
	return copy_length;
}

/*********** readlink **********/

typedef ssize_t (*_real_readlink_t)(
	const char* pathname,
	char* buf,
	size_t bufsiz
);

ssize_t _real_readlink(const char* pathname, char* buf, size_t bufsiz) {
	return ((_real_readlink_t)dlsym(RTLD_NEXT, "readlink"))(pathname, buf, bufsiz);
}

ssize_t readlink(const char* pathname, char* buf, size_t bufsiz) {
	if (path_is_proc_self_exe(pathname)) {
		return proc_self_exe_readlink(buf, bufsiz);
	}

	return _real_readlink(pathname, buf, bufsiz);
}

/*********** readlinkat **********/

typedef ssize_t (*_real_readlinkat_t)(
	int dirfd,
	const char* pathname,
	char* buf,
	size_t bufsiz
);

ssize_t _real_readlinkat(int dirfd, const char* pathname, char* buf, size_t bufsiz) {
	return ((_real_readlinkat_t)dlsym(RTLD_NEXT, "readlinkat"))(
		dirfd,
		pathname,
		buf,
		bufsiz
	);
}

ssize_t readlinkat(int dirfd, const char* pathname, char* buf, size_t bufsiz) {
	if (path_is_proc_self_exe(pathname)) {
		// NOTE: Since `pathname` is absolute, `dirfd` is ignored.
		return proc_self_exe_readlink(buf, bufsiz);
	}

	return _real_readlinkat(dirfd, pathname, buf, bufsiz);
}

/*********** glibc __readlink **********/

ssize_t __readlink(const char* pathname, char* buf, size_t bufsiz) {
	if (path_is_proc_self_exe(pathname)) {
		return proc_self_exe_readlink(buf, bufsiz);
	}

	return _real_readlink(pathname, buf, bufsiz);
}

/*********** open **********/

typedef ssize_t (*_real_open_t)(
	const char* pathname,
	int flags,
	mode_t mode
);

int _real_open(const char* pathname, int flags, mode_t mode) {
	return ((_real_open_t)dlsym(RTLD_NEXT, "open"))(pathname, flags, mode);
}

int open(const char* pathname, int flags, mode_t mode) {
	if (path_is_proc_self_exe(pathname)) {
		return _real_open(IDENTITY_PATH, flags, mode);
	}

	return _real_open(pathname, flags, mode);
}

/*********** open64 **********/

typedef ssize_t (*_real_open64_t)(
	const char* pathname,
	int flags,
	mode_t mode
);

int _real_open64(const char* pathname, int flags, mode_t mode) {
	return ((_real_open64_t)dlsym(RTLD_NEXT, "open64"))(pathname, flags, mode);
}

int open64(const char* pathname, int flags, mode_t mode) {
	if (path_is_proc_self_exe(pathname)) {
		return _real_open64(IDENTITY_PATH, flags, mode);
	}

	return _real_open64(pathname, flags, mode);
}

/*********** openat **********/

typedef ssize_t (*_real_openat_t)(
	int dirfd,
	const char* pathname,
	int flags,
	mode_t mode
);

int _real_openat(int dirfd, const char* pathname, int flags, mode_t mode) {
	return ((_real_openat_t)dlsym(RTLD_NEXT, "openat"))(
		dirfd,
		pathname,
		flags,
		mode
	);
}

int openat(int dirfd, const char* pathname, int flags, mode_t mode) {
	if (path_is_proc_self_exe(pathname)) {
		return _real_openat(dirfd, IDENTITY_PATH, flags, mode);
	}

	return _real_openat(dirfd, pathname, flags, mode);
}

/*********** openat64 **********/

typedef ssize_t (*_real_openat64_t)(
	int dirfd,
	const char* pathname,
	int flags,
	mode_t mode
);

int _real_openat64(int dirfd, const char* pathname, int flags, mode_t mode) {
	return ((_real_openat64_t)dlsym(RTLD_NEXT, "openat64"))(
		dirfd,
		pathname,
		flags,
		mode
	);
}

int openat64(int dirfd, const char* pathname, int flags, mode_t mode) {
	if (path_is_proc_self_exe(pathname)) {
		return _real_openat64(dirfd, IDENTITY_PATH, flags, mode);
	}

	return _real_openat64(dirfd, pathname, flags, mode);
}
