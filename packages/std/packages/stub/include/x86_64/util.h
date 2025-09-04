#pragma once
#include <stddef.h>

// Memcpy implementation.
__attribute__((naked))
static void* memcpy (
	void*		dst, 
	const void*	src, 
	size_t		len
) {
	asm volatile (
		"rep rex.w movsb\n\t"
		"ret\n\t" 
		: "+D"(dst), "+S"(src), "+c"(len) 
		:
		: "memory", "cc"
	);
}

// Memset implementation.
__attribute__((naked))
static void* memset (
	void* dst,
	int c, 
	size_t n
) {
	asm volatile (
		"rep rex.w stosb\n\t"
		"ret\n\t" 
		: "+D"(dst), "+c"(n) 
		: "a"(c) 
		: "memory", "cc"
	);
}
