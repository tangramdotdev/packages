#pragma once
#include <stddef.h>

// Memcpy implementation.
__attribute__((naked))
static void* memcpy (
	void*		dst, 
	const void*	src, 
	size_t		len
) {
	// TODO
}

// Memset implementation.
__attribute__((naked))
static void* memset (
	void* dst,
	int c, 
	size_t n
) {
	// TODO
}
