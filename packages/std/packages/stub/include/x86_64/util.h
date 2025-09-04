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
		"rep rex.w movsb;"
		"ret;" 
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
		"rep rex.w stosb;"
		"ret;" 
		: "+D"(dst), "+c"(n) 
		: "a"(c) 
		: "memory", "cc"
	);
}

__attribute__((naked)) 
static void jump_to_entrypoint (void* stack, void* entrypoint) {
	asm volatile (
		"mov %rdi, %rsp;"	// set the stack pointer.
		"xor %rax, %rax;"	// clear the return value.
		"xor %rbp, %rbp;"	// clear the frame pointer.
		"mov $0, %rdx;" 	// clear rdx because we have no cleanup code.
		"jmp *%rsi;"		// jump to the entrypoint.
	);
	__builtin_unreachable();
}
