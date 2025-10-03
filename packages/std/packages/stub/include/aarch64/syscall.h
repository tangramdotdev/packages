#pragma once

static long syscall1 (
	long nr,
	long arg1
) {
	register long x8 asm("x8") = nr;
	register long x0 asm("x0") = arg1;
	asm volatile (
		"svc #0;"
		"ret;"
		:
		: "r"(x8), "r"(x0)
		: "memory"
	);
}

static long syscall2 (
	long nr,
	long arg1,
	long arg2
) {
	register long x8 asm("x8") = nr;
	register long x0 asm("x0") = arg1;
	register long x1 asm("x1") = arg2;
	asm volatile (
		"svc #0;"
		"ret;"
		:
		: "r"(x8), "r"(x0), "r"(x1)
		: "memory"
	);
}

static long syscall3 (
	long nr,
	long arg1,
	long arg2,
	long arg3
) {
	register long x8 asm("x8") = nr;
	register long x0 asm("x0") = arg1;
	register long x1 asm("x1") = arg2;
	register long x2 asm("x2") = arg3;
	asm volatile (
		"svc #0;"
		"ret;"
		:
		: "r"(x8), "r"(x0), "r"(x1), "r"(x2)
		: "memory"
	);
}

static long syscall4 (
	long nr,
	long arg1,
	long arg2,
	long arg3,
	long arg4
) {
	register long x8 asm("x8") = nr;
	register long x0 asm("x0") = arg1;
	register long x1 asm("x1") = arg2;
	register long x2 asm("x2") = arg3;
	register long x3 asm("x3") = arg4;
	asm volatile (
		"svc #0;"
		"ret;"
		:
		: "r"(x8), "r"(x0), "r"(x1), "r"(x2), "r"(x3)
		: "memory"
	);
}

static long syscall5 (
	long nr,
	long arg1,
	long arg2,
	long arg3,
	long arg4,
	long arg5
) {
	register long x8 asm("x8") = nr;
	register long x0 asm("x0") = arg1;
	register long x1 asm("x1") = arg2;
	register long x2 asm("x2") = arg3;
	register long x3 asm("x3") = arg4;
	register long x4 asm("x4") = arg5;
	asm volatile (
		"svc #0;"
		"ret;"
		:
		: "r"(x8), "r"(x0), "r"(x1), "r"(x2), "r"(x3), "r"(x4)
		: "memory"
	);
}

static long syscall6 (
	long nr,
	long arg1,
	long arg2,
	long arg3,
	long arg4,
	long arg5,
	long arg6
) {
	register long x8 asm("x8") = nr;
	register long x0 asm("x0") = arg1;
	register long x1 asm("x1") = arg2;
	register long x2 asm("x2") = arg3;
	register long x3 asm("x3") = arg4;
	register long x4 asm("x4") = arg5;
	register long x5 asm("x5") = arg6;
	asm volatile (
		"svc #0;"
		"ret;"
		:
		: "r"(x8), "r"(x0), "r"(x1), "r"(x2), "r"(x3), "r"(x4), "r"(x5)
		: "memory"
	);
}