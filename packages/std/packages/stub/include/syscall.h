#pragma once
#include <stddef.h>
#include <stdint.h>

#if defined __aarch64__
#include "aarch64/syscall.h"
#endif

#if defined __x86_64__
#include "x86_64/syscall.h"
#endif

// open constants
#define O_RDONLY     00
#define O_WRONLY     01
#define O_RDWR	     02
#define O_CREAT	   0100

// mmap constants
#define PROT_READ 		0x1
#define PROT_WRITE 		0x2
#define PROT_EXEC 		0x4
#define MAP_SHARED		0x01
#define MAP_PRIVATE  		0x02
#define MAP_ANONYMOUS 		0x20
#define MAP_FIXED		0x10
#define MAP_GROWSDOWN		0x00100
#define MAP_FIXED_NOREPLACE 	0x100000
#define MAP_FAILED		(void*)-1

// rlimit constants
#define RLIMIT_STACK 3

// getrandom constants
#define GRND_NONBLOCK 0x01

// lseek constants
#define SEEK_SET 0
#define SEEK_CUR 1
#define SEEK_END 2

// stdio fds
#define STDOUT_FILENO 1
#define STDERR_FILENO 2

typedef long off_t;
typedef unsigned long __rlim_t;
typedef struct {
	__rlim_t	soft;
	__rlim_t	hard;
} rlimit_t;
typedef struct {
	uint8_t buf[256];
} stat_t;

static inline long write (int fd, const void *buf, size_t count) {
	return syscall3(__NR_write, (long)fd, (long)buf, (long)count);
}

static inline int open (const char* path, int flags, int mode) {
	#if defined __x86_64__
		return (int)syscall3(__NR_open, (long)path, (long)flags, (long)mode);
	#endif

	// aarch64 has no "open" syscall. We have to use openat.
	#if defined __aarch64__
		return (int)syscall4(__NR_openat, -1, (long)path, (long)flags, (long)mode);
	#endif
}

static inline int close (int fd) {
	return (int)syscall1(__NR_close, (long)fd);
}

static inline int stat (const char* pathname, stat_t* statbuf) {
	#if defined __x86_64__
		return (int)syscall2(__NR_stat, (long)pathname, (long)statbuf);
	#endif

	// aarch64 has no "stat" syscapp. We have to use fstat.
	#if defined __aarch64__
		int fd = open(pathname, O_RDONLY, 0);
		if (fd < 0) {
			return fd;
		}
		int status = syscall2(__NR_fstat, fd, (long)statbuf);
		close(fd);
		return status;
	#endif
}

static inline long lseek (int fd, off_t offset, int whence) {
	return syscall3(__NR_lseek, (long)fd, (long)offset, (long)whence);
}

static inline void* mmap(
	void* 		addr,
	uint64_t 	length,
	uint64_t 	prot,
	uint64_t 	flags,
	int64_t 	fd,
	uint64_t 	offset
) {
	return (void*)syscall6(
		__NR_mmap, 
		(long)addr, 
		(long)length, 
		(long)prot, 
		(long)flags, 
		(long)fd, 
		(long)offset
	);
}

static inline int munmap(void* addr, uint64_t len) {
	return (int)syscall2(__NR_munmap, (long)addr, (long)len);
}

static inline int pread64 (int fd, void* buf, size_t count, off_t offset) {
	return (int)syscall4(__NR_pread64, (long)fd, (long)buf, (long)count, (long)offset);
}

static inline int execve (char* pathname, char** argv, char** envp) {
	return (int)syscall3(__NR_execve, (long)pathname, (long)argv, (long)envp);
}

static inline void exit (int status) {
	syscall1(__NR_exit, (long)status);
	__builtin_unreachable();
}

static inline int getcwd(char* buf, size_t size) {
	return (int)syscall2(__NR_getcwd, (long)buf, (long)size);
}

static inline long readlink (const char* pathname, char* buf, size_t bufsiz) {
	#if defined __x86_64__
		return syscall3(__NR_readlink, (long)pathname, (long)buf, (long)bufsiz);
	#endif

	// aarch64 has no "readlink" syscall. We have to use readlinkat.
	#if defined __aarch64__
		return syscall4(__NR_readlinkat, -1, (long)pathname, (long)buf, (long)bufsiz);
	#endif
}

static inline int getrlimit (int resource, rlimit_t* rlim) {
	return (int)syscall2(__NR_getrlimit, (long)resource, (long)rlim);
}

static inline long getrandom (void *buf, size_t buflen, unsigned int flags) {
	return (long)syscall3(__NR_getrandom, (long)buf, (long)buflen, (long)flags);
}
