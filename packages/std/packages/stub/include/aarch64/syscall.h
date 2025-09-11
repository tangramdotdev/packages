// Minimal syscall interface required by the stub.
#pragma once
#include <linux/unistd.h>
#include <stddef.h>
#include <stdint.h>


#define PROT_READ 		0x1
#define PROT_WRITE 		0x2
#define PROT_EXEC 		0x4
#define MAP_PRIVATE  		0x02
#define MAP_ANONYMOUS 		0x20
#define MAP_FIXED		0x10
#define MAP_FIXED_NOREPLACE 	0x100000
#define MAP_FAILED		(void*)-1

#define RLIMIT_STACK 3

#define O_RDONLY 0
#define SEEK_SET 0
#define SEEK_CUR 1
#define SEEK_END 2

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

__attribute__((naked))
static long write (int fd, const void *buf, size_t count) {
	register long x8 asm("x8") = __NR_write;
	register long x0 asm("x0") = (long)fd;
	register long x1 asm("x1") = (long)buf;
	register long x2 asm("x2") = (long)count;
	asm volatile(
		"svc 0\n\t"
		"ret\n\t" 
		:
		: "r"(x8), "0"(x0), "r"(x1), "r"(x2)
		: "rcx", "r11", "memory"
	);
}

__attribute__((naked))
static int open (const char* path, int mode) {
	register long x8 asm("x8") = __NR_open;
	register long x0 asm("x0") = (long)path;
	register long x1 asm("x1") = (long)mode;
	asm volatile(
		"svc 0\n\t"
		"ret\n\t"
		:
		: "r"(x8), "0"(x0), "r"(x1)
		: "memory", "cc"
	);
}

__attribute__((naked))
static int close(int fd) {
	register long x8 asm("x8") = __NR_close;
	register long x0 asm("x0") = (long)fd;
	asm volatile(
		"svc 0\n\t"
		"ret\n\t"
		:
		: "r"(x8), "0"(x0)
		: "memory", "cc"
	);

}

__attribute__((naked))
static long lseek (int fd, off_t offset, int whence) {
	register long x8 asm("x8") = __NR_lseek;
	register long x0 asm("x0") = (long)fd;
	register long x1 asm("x1") = (long)offset;
	register long x2 asm("x2") = (long)whence;
	asm volatile(
		"svc 0\n\t"
		"ret\n\t"
		:
		: "r"(x8), "0"(x0), "r"(x1), "r"(x2)
		: "memory", "cc"
	);
}

__attribute__((naked))
static int getrlimit (int resource, rlimit_t* rlim) {
	register long x8 asm("x8") = __NR_getrlimit;
	register long x0 asm("x0") = (long)resource;
	register long x1 asm("x1") = (long)rlim;
	asm volatile(
		"svc 0\n\t"
		"ret\n\t"
		:
		: "r"(x8), "0"(x0), "r"(x1)
		: "memory", "cc"
	);
}

__attribute__((naked))
static int pread64 (int fd, void* buf, size_t count, off_t offset) {
	register long x8 asm("x8") = __NR_pread64;
	register long x0 asm("x0") = (long)fd;
	register long x1 asm("x1") = (long)buf;
	register long x2 asm("x2") = (long)count;
	register long x1 asm("x1") = (long)offset;
	asm volatile(
		"svc 0\n\t"
		"ret\n\t"
		:
		: "r"(x8)
		: "memory", "cc"
	);
}

__attribute__((naked))
static void exit (int status)
{
	register long x8 asm("x8") = __NR_exit;
	register long x0 asm("x0") = (long)status;
	asm volatile(
		"svc 0\n\t"
		"ret\n\t"
		:
		: "r"(x8), "0"(x0)
		: "memory", "cc"
	);
	__builtin_unreachable();
}

__attribute__((naked))
static void* mmap(
	void* 		addr,
	uint64_t 	length,
	uint64_t 	prot,
	uint64_t 	flags,
	int64_t 	fd,
	uint64_t 	offset
) {
	register long x8 asm("x8") = __NR_mmap;
	register long x0 asm("x0") = (long)addr;
	register long x1 asm("x1") = (long)length;
	register long x2 asm("x2") = (long)prot;
	register long x3 asm("x3") = (long)flags;
	register long x4 asm("x4") = (long)fd;
	register long x5 asm("x5") = (long)offset;
	asm volatile(
		"svc 0\n\t"
		"ret\n\t"
		:
		: "r"(x8), "0"(x0), "r"(x1), "r"(x2), "r"(x3), "r"(x4), "r"(x5) 
		: "memory", "cc"
	);
}

__attribute__((naked))
static int munmap(
	void*		addr,
	uint64_t	len
) {
	register long x8 asm("x8") = __NR_munmap;
	register long x0 asm("x0") = (long)addr;
	register long x1 asm("x1") = (long)len;
	asm volatile(
		"svc 0\n\t"
		"ret\n\t"
		:
		: "r"(x8), "0"(x0), "r"(x1)
		: "memory", "cc"
	);
}

__attribute__((naked))
static char* getcwd(char* buf, size_t size) {
	register long x8 asm("x8") = __NR_getcwd;
	register long x0 asm("x0") = (long)buf;
	register long x1 asm("x1") = (long)size;
	asm volatile(
		"svc 0\n\t"
		"ret\n\t"
		:
		: "r"(x8), "0"(x0), "r"(x1)
		: "memory", "cc"
	);
}

__attribute__((naked))
int stat (const char* pathname, stat_t* statbuf) {
	register long x8 asm("x8") = __NR_stat;
	register long x0 asm("x0") = (long)pathname;
	register long x1 asm("x1") = (long)statbuf;
	asm volatile(
		"svc 0\n\t"
		"ret\n\t"
		:
		: "r"(x8), "0"(x0), "r"(x1)
		: "memory", "cc"
	);
}
