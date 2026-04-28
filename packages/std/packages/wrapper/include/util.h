#pragma once

// Common includes.
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifndef TG_USE_SYSCALLS
#include <unistd.h>
#endif

// Internals.
#include "common.h"
#include "debug.h"
#include "syscall.h"

#ifdef __aarch64__
#include "aarch64/util.h"
#endif

#ifdef __x86_64__
#include "x86_64/util.h"
#endif

#define STRING_LITERAL(s) (String) { .ptr = (uint8_t*)(s), .len = tg_strlen((s)) }

typedef struct {
	uint8_t* ptr;
	uint64_t len;
} String;

#ifdef TG_USE_SYSCALLS
void* memcpy (void* dst, const void* src, size_t len);
void* memset (void* dst, int c, size_t n);
#else
#include <string.h>
#endif

TG_VISIBILITY size_t strlen_including_nul (const char* str);
TG_VISIBILITY size_t tg_strlen (const char* s);
TG_VISIBILITY String parent_dir (String path);
TG_VISIBILITY bool streq (String a, String b);
TG_VISIBILITY bool cstreq (String s, const char* cstr);
TG_VISIBILITY bool starts_with (String a, String prefix);
TG_VISIBILITY bool cstarts_with (String a, const char* prefix);
TG_VISIBILITY void reverse (String* s);
TG_VISIBILITY void read_all (int tracing, int fd, char* dst, size_t length, off_t offset);
TG_VISIBILITY void append_to_string(String* dst, const String* src, size_t capacity);
TG_VISIBILITY void append_ch_to_string(String* dst, char ch, size_t capacity);

#ifdef TG_IMPLEMENTATION
TG_VISIBILITY void tg_mktemp (String* string) {
	#ifdef TG_USE_SYSCALLS
	ABORT_IF(string->len <= 6, "string too small");
	size_t offset = string->len - 6;
	const char LOOKUP[256] =
		"0123456789abcdefghijklmnopqrstuzwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ01"
		"23456789abcdefghijklmnopqrstuzwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123"
		"456789abcdefghijklmnopqrstuzwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ012345"
		"6789abcdefghijklmnopqrstuzwxyzABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh";
	ABORT_IF(getrandom((void*)&string->ptr[offset], 6, GRND_NONBLOCK) != 6, "getrandom() failed");
	for (; offset < string->len; offset++) {
		string->ptr[offset] = LOOKUP[(uint8_t)string->ptr[offset]];
	}
	#else
	ABORT_IF(mkstemp((char*)string->ptr) < 0, "mkstemp() failed");
	#endif
}

TG_VISIBILITY size_t tg_strlen (const char* s) {
	size_t n = 0;
	for (; s[n]; n++) {}
	return n;
}

TG_VISIBILITY size_t strlen_including_nul (const char* str) {
	size_t len = 0;
	for(; str[len]; len++) {}
	len += 1;
	return len;
}

TG_VISIBILITY String parent_dir (String path) {
	// Edge case: root directory.
	for(int i = 0; i < 2; i++) {
		// Hack off slashes.
		for (; path.len > 1; path.len--) {
			if (path.ptr[path.len - 1] == '/') {
				continue;
			}
			break;
		}

		// If this is the first pass, remove the trailing component.
		if (i == 0) {
			// Edge case: root directory.
			if (path.len == 1 && path.ptr[0] == '/') {
				path.ptr = NULL;
				path.len = 0;
				return path;
			}

			for(; path.len > 0; path.len--) {
				if (path.ptr[path.len - 1] == '/') {
					break;
				}
			}
		}
	}
	return path;
}

TG_VISIBILITY bool streq (String a, String b) {
	if (a.len != b.len) {
		return false;
	}
	for (size_t n = 0; n < a.len; n++) {
		if (a.ptr[n] != b.ptr[n]) {
			return false;
		}
	}
	return true;
}

TG_VISIBILITY bool cstreq (String s, const char* cstr) {
	for (int i = 0; i < s.len; i++) {
		if (s.ptr[i] != cstr[i]) {
			return false;
		}
	}
	return !cstr[s.len];
}

TG_VISIBILITY bool starts_with (String a, String prefix) {
	if (a.len < prefix.len) {
		return false;
	}
	for (size_t n = 0; n < prefix.len; n++) {
		if (a.ptr[n] != prefix.ptr[n]) {
			return false;
		}
	}
	return true;
}

TG_VISIBILITY bool cstarts_with (String a, const char* prefix) {
	for (size_t n = 0; n < a.len; n++) {
		if (!prefix[n]) {
			return false;
		}
		if (a.ptr[n] != prefix[n]) {
			return false;
		}
	}
	return true;
}


TG_VISIBILITY void reverse (String* s) {
	int i = 0;
	int j = s->len - 1;
	while (i < j) {
		char buf = s->ptr[i];
		s->ptr[i] = s->ptr[j];
		s->ptr[j] = buf;
		i++;
		j--;
	}
}

TG_VISIBILITY void read_all (int tracing, int fd, char* dst, size_t length, off_t offset) {
	if (tracing) {
		trace("read_all length:%ld offset:%ld\n", length, offset);
	}
	while(length) {
		int result = pread(fd, (void*)dst, length, offset);
		if (tracing) {
			trace("read_all result = %d\n", result);
		}
		ABORT_IF(result < 0, "failed to read from file");
		if (result == 0) {
			break;
		}
		length	-= result;
		offset	+= result;
		dst	+= result;
	}
}

TG_VISIBILITY uint64_t fnv1a (String string) {
	uint64_t hash = 0xcbf29ce484222325;
	const uint8_t* itr = string.ptr;
	const uint8_t* end = string.ptr + string.len;
	for(; itr != end; itr++) {
		hash = hash ^ (uint64_t)*itr;
		hash = hash * 0x100000001b3;
	}
	return hash;
}

TG_VISIBILITY size_t nextpow2 (size_t n) {
	if (n == 0) {
		return 1;
	} else if ((n & (n - 1)) == 0) {
		return n;
	} else {
		return (size_t)(1U << (32 - __builtin_clz((uint32_t)n)));
	}
}

TG_VISIBILITY void append_to_string (String* dst, const String* src, size_t capacity) {
	ABORT_IF(dst->len + src->len >= capacity, "out of capacity");
	memcpy(dst->ptr + dst->len, src->ptr, src->len);
	dst->len += src->len;
}

TG_VISIBILITY void append_ch_to_string (String* dst, char ch, size_t capacity) {
	ABORT_IF(dst->len + 1 >= capacity, "out of capacity");
	dst->ptr[dst->len] = ch;
	dst->len += 1;
}

#endif // TG_IMPLEMENTATION
