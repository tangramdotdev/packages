#pragma once
__attribute__((naked))
static long syscall1 (
	long nr,
	long arg1
) {
	register long rax asm("rax") = nr;
	register long rdi asm("rdi") = arg1;
	asm volatile (
		"syscall;"
		"ret;"
		:
		: "a"(rax), "D"(rdi)
		: "rcx", "r11", "memory"
	);
}

__attribute__((naked))
static long syscall2 (
	long nr,
	long arg1,
	long arg2
) {
	register long rax asm("rax") = nr;
	register long rdi asm("rdi") = arg1;
	register long rsi asm("rsi") = arg2;
	asm volatile (
		"syscall;"
		"ret;"
		:
		: "a"(rax), "D"(rdi), "S"(rsi)
		: "rcx", "r11", "memory"
	);
}

__attribute__((naked))
static long syscall3 (
	long nr,
	long arg1,
	long arg2,
	long arg3
) {
	register long rax asm("rax") = nr;
	register long rdi asm("rdi") = arg1;
	register long rsi asm("rsi") = arg2;
	register long rdx asm("rdx") = arg3;
	asm volatile (
		"syscall;"
		"ret;"
		:
		: "a"(rax), "D"(rdi), "S"(rsi), "d"(rdx)
		: "rcx", "r11", "memory"
	);
}

__attribute__((naked))
static long syscall4 (
	long nr,
	long arg1,
	long arg2,
	long arg3,
	long arg4
) {
	register long rax asm("rax") = nr;
	register long rdi asm("rdi") = arg1;
	register long rsi asm("rsi") = arg2;
	register long rdx asm("rdx") = arg3;
	register long r10 asm("r10") = arg4;
	asm volatile (
		"syscall;"
		"ret;"
		:
		: "a"(rax), "D"(rdi), "S"(rsi), "d"(rdx), "r"(r10)
		: "rcx", "r11", "memory"
	);
}

__attribute__((naked))
static long syscall5 (
	long nr,
	long arg1,
	long arg2,
	long arg3,
	long arg4,
	long arg5
) {
	register long rax asm("rax") = nr;
	register long rdi asm("rdi") = arg1;
	register long rsi asm("rsi") = arg2;
	register long rdx asm("rdx") = arg3;
	register long r10 asm("r10") = arg4;
	register long r8 asm("r8") = arg5;
	asm volatile (
		"syscall;"
		"ret;"
		:
		: "a"(rax), "D"(rdi), "S"(rsi), "d"(rdx), "r"(r10), "r"(r8)
		: "rcx", "r11", "memory"
	);
}

__attribute__((naked))
static long syscall6 (
	long nr,
	long arg1,
	long arg2,
	long arg3,
	long arg4,
	long arg5,
	long arg6
) {
	register long rax asm("rax") = nr;
	register long rdi asm("rdi") = arg1;
	register long rsi asm("rsi") = arg2;
	register long rdx asm("rdx") = arg3;
	register long r10 asm("r10") = arg4;
	register long r8 asm("r8") = arg5;
	register long r9 asm("r9") = arg6;
	asm volatile (
		"syscall;"
		"ret;"
		:
		: "a"(rax), "D"(rdi), "S"(rsi), "d"(rdx), "r"(r10), "r"(r8), "r"(r9)
		: "rcx", "r11", "memory"
	);
}
