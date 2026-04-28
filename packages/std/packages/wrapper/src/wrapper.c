#ifdef __linux__
#define TG_USE_SYSCALLS
#endif
#define TG_VISIBILITY_STATIC
#define TG_IMPLEMENTATION
#include "wrapper.h"

#ifdef __linux__
void* memcpy (
	void*		dst,
	const void*	src,
	size_t		len
) {
	for (size_t i = 0; i < len; i++) {
		((uint8_t*)dst)[i] = ((const uint8_t*)src)[i];
	}
	return dst;
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

#ifdef __aarch64__
#include "syscall.h"
double __trunctfdf2 (long double ld) {
	exit(111);
	return 0.0;
}
#endif // __aarch64__
#endif // __linux__
