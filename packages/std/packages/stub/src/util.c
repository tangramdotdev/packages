/*
	gcc appears to have an issue with some functions (memset and memcpy) on some architectures (aarch64) which forbids overriding them in a static function declaration within a single header file. In addition, conversion
	of long doubles to doubles is a built-in provided by lib-gcc on aarch64. 

	We don't care about any of that, so this source file works around it.
*/
#include <stddef.h>
#include <stdint.h>

#ifdef __x86_64__
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

__attribute__((naked))
void* memset (
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
#endif

#ifdef __aarch64__
#include "syscall.h"
double __trunctfdf2 (long double ld) {
	exit(111);
	return 0.0;
}

void* memcpy (
	void*		dst, 
	const void*	src, 
	size_t		len
) {
	for (size_t i = 0; i < len; i++) {
		((uint8_t*)dst)[i] = ((const uint8_t*)src)[i];
	}
}

void* memset (
	void* dst,
	int c, 
	size_t n
) {
	for (size_t i = 0; i < n; i++) {
		((uint8_t*)dst)[i] = (uint8_t)(c);
	}
	return dst;
}
#endif
