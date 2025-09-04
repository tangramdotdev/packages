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
	asm volatile(
		"syscall\n\t"
		"ret\n\t" 
		:
		: "a"(__NR_write), "D"((long)fd), "S"(buf), "d"(count)
		: "rcx", "r11", "memory"
	);
}

__attribute__((naked))
static int open (const char* path, int mode) {
	asm volatile(
		"syscall\n\t"
		"ret\n\t"
		:
		: "a"(__NR_open), "D"(path), "S"(mode)
		: "rcx", "r11", "memory"
	);
}

__attribute__((naked))
static int close(int fd) {
	asm volatile (
		"syscall\n\t"
		"ret"
		: 
		: "a"(__NR_close), "D"(fd) 
		: "rcx", "r11", "memory"
	);
}

__attribute__((naked))
static long lseek (int fd, off_t offset, int whence) {
	asm volatile("syscall;ret" : : "a"(__NR_lseek), "D"((long)fd), "S"(offset), "d"((long)whence): "rcx", "r11", "memory");
}

__attribute__((naked))
static int getrlimit (int resource, rlimit_t* rlim) {
	asm volatile(
		"syscall\n\t"
		"ret\n\t"
		:
		: "a"(__NR_getrlimit)
		: "rcx", "r11", "memory"
	);
}

__attribute__((naked))
static int pread64 (int fd, void* buf, size_t count, off_t offset) {
	register uint64_t r10 __asm__("r10") = offset;
	asm volatile(
		"syscall\n\t"
		"ret\n\t"
		:
		: "a"(__NR_pread64), "D"(fd), "S"(buf), "d"(count), "r"(r10)
		: "rcx", "r11", "memory"
	);
}

__attribute__((naked))
static void exit (int status)
{
	asm volatile("syscall": : "a"(__NR_exit), "D"(status));
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
	register uint64_t r10 __asm__("r10") = flags;
	register int64_t r8 __asm__("r8") = fd;
	register uint64_t r9 __asm__("r9") = offset;
	asm volatile(
		"syscall\n\t"
		"ret\n\t"
		:
		: "a"(__NR_mmap),
		  "D"(addr),
		  "S"(length),
		  "d"(prot),
		  "r"(r10),
		  "r"(r8),
		  "r"(r9)
		: "memory"
	);
}

__attribute__((naked))
static int munmap(
	void*		addr,
	uint64_t	len
) {
	asm volatile (
		"syscall\n\t"
		"ret\n\t"
		:
		: "a"(__NR_munmap), "D"(addr), "S"(len)
		: "memory"
	);
}

__attribute__((naked))
static char* getcwd(char* buf, size_t size) {
	asm volatile (
		"syscall\n\t"
		"ret\n\t"
		:
		: "a"(__NR_getcwd), "D"(buf), "S"(size)
		: "memory"
	);
}

__attribute__((naked))
int stat (const char* pathname, stat_t* statbuf) {
asm volatile (
		"syscall\n\t"
		"ret\n\t"
		:
		: "a"(__NR_stat), "D"(pathname), "S"(statbuf)
		: "memory"
	);
}
