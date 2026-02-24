#pragma once

#define __NR_write		1
#define __NR_open		2
#define __NR_close		3
#define __NR_stat		4
#define __NR_lseek		8
#define __NR_mmap		9
#define __NR_munmap		11
#define __NR_pread64	17
#define __NR_execve		59
#define __NR_exit		60
#define __NR_readlink	89
#define __NR_getrlimit	97
#define __NR_getrandom	318

static inline long syscall1 (
	long nr,
	long arg1
) {
	long ret;
	register long rax asm("rax") = nr;
	register long rdi asm("rdi") = arg1;
	asm volatile (
		"syscall"
		: "=a"(ret)
		: "a"(rax), "D"(rdi)
		: "rcx", "r11", "memory"
	);
	return ret;
}

static inline long syscall2 (
	long nr,
	long arg1,
	long arg2
) {
	long ret;
	register long rax asm("rax") = nr;
	register long rdi asm("rdi") = arg1;
	register long rsi asm("rsi") = arg2;
	asm volatile (
		"syscall"
		: "=a"(ret)
		: "a"(rax), "D"(rdi), "S"(rsi)
		: "rcx", "r11", "memory"
	);
	return ret;
}

static inline long syscall3 (
	long nr,
	long arg1,
	long arg2,
	long arg3
) {
	long ret;
	register long rax asm("rax") = nr;
	register long rdi asm("rdi") = arg1;
	register long rsi asm("rsi") = arg2;
	register long rdx asm("rdx") = arg3;
	asm volatile (
		"syscall"
		: "=a"(ret)
		: "a"(rax), "D"(rdi), "S"(rsi), "d"(rdx)
		: "rcx", "r11", "memory"
	);
	return ret;
}

static inline long syscall4 (
	long nr,
	long arg1,
	long arg2,
	long arg3,
	long arg4
) {
	long ret;
	register long rax asm("rax") = nr;
	register long rdi asm("rdi") = arg1;
	register long rsi asm("rsi") = arg2;
	register long rdx asm("rdx") = arg3;
	register long r10 asm("r10") = arg4;
	asm volatile (
		"syscall"
		: "=a"(ret)
		: "a"(rax), "D"(rdi), "S"(rsi), "d"(rdx), "r"(r10)
		: "rcx", "r11", "memory"
	);
	return ret;
}

static inline long syscall5 (
	long nr,
	long arg1,
	long arg2,
	long arg3,
	long arg4,
	long arg5
) {
	long ret;
	register long rax asm("rax") = nr;
	register long rdi asm("rdi") = arg1;
	register long rsi asm("rsi") = arg2;
	register long rdx asm("rdx") = arg3;
	register long r10 asm("r10") = arg4;
	register long r8 asm("r8") = arg5;
	asm volatile (
		"syscall"
		: "=a"(ret)
		: "a"(rax), "D"(rdi), "S"(rsi), "d"(rdx), "r"(r10), "r"(r8)
		: "rcx", "r11", "memory"
	);
	return ret;
}

static inline long syscall6 (
	long nr,
	long arg1,
	long arg2,
	long arg3,
	long arg4,
	long arg5,
	long arg6
) {
	long ret;
	register long rax asm("rax") = nr;
	register long rdi asm("rdi") = arg1;
	register long rsi asm("rsi") = arg2;
	register long rdx asm("rdx") = arg3;
	register long r10 asm("r10") = arg4;
	register long r8 asm("r8") = arg5;
	register long r9 asm("r9") = arg6;
	asm volatile (
		"syscall"
		: "=a"(ret)
		: "a"(rax), "D"(rdi), "S"(rsi), "d"(rdx), "r"(r10), "r"(r8), "r"(r9)
		: "rcx", "r11", "memory"
	);
	return ret;
}
