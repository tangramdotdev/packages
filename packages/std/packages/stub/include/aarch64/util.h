#pragma once
#include <stddef.h>
#include <stdint.h>

static void* memcpy (
	void*		dst, 
	const void*	src, 
	size_t		len
) {
	for (size_t i = 0; i < len; i++) {
		((uint8_t*)dst)[i] = ((const uint8_t*)src)[i];
	}
}

static void* memset (
	void* dst,
	int c, 
	size_t n
) {
	for (size_t i = 0; i < n; i++) {
		((uint8_t*)dst)[i] = (uint8_t)(c);
	}
	return dst;
}

__attribute__((naked)) 
static void jump_to_entrypoint (void* stack, void* entrypoint) {
	asm volatile (
		"mov sp, x0;"		// set the stack pointer.
		"mov x29, xzr;"		// clear the frame pointer.
		"mov x0, xzr;"		// clear atexit pointer
		"br x1;"		// jump to the entrypoint
	);
	__builtin_unreachable();
}
