#pragma once
#if BREAKPOINTS
	#define BREAK asm volatile ("int3");
#else
	#define BREAK
#endif

// Common includes.
#include <elf.h>
#include <linux/unistd.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

// Internals.
#include "syscall.h"
#include "x86_64/util.h"

// Common string type.
typedef struct {
	uint8_t* ptr;
	uint64_t len;
} String;

// Get the length of a string including the null byte.
static size_t strlen_including_nul (const char* str) {
	size_t len = 0;
	for(; str[len]; len++) {}
	len += 1;
	return len;
}

static size_t strlen (const char* s) {
	size_t n = 0;
	for (; s[n] != 0; n++) {}
	return n;
}

#define STRING_LITERAL(s) { .ptr = (uint8_t*)s, .len = strlen(s) }

typedef struct PathComponent PathComponent;
struct PathComponent {
	int    type; 		
	String contents;
};


static String parent_dir (String path) {
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


static bool streq (String a, String b) {
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

static bool cstreq (String s, const char* cstr) {
	for (int i = 0; i < s.len; i++) {
		if (s.ptr[i] != cstr[i]) {
			return false;
		}
	}
	if (cstr[s.len]) {
		return false;
	}
	return true;
}

static bool starts_with (String a, String prefix) {
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

static bool cstarts_with (String a, const char* prefix) {
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

static String join (Arena* arena, String separator, String* strings, size_t nstrings) {
	size_t len = 0;
	for (size_t n = 0; n < nstrings; n++) {
		len += strings[n].len;
		if (n != (nstrings - 1)) {
			len += separator.len;
		}
	}

	String out = {0};
	out.ptr = ALLOC_N(arena, len + 1, uint8_t);

	for (size_t n = 0; n < nstrings; n++) {
		if (strings[n].ptr) {
			memcpy(out.ptr + out.len, strings[n].ptr, strings[n].len);
			out.len += strings[n].len;
			if (separator.ptr && n != (nstrings - 1)) {
				memcpy(out.ptr + out.len, separator.ptr, separator.len);
				out.len += separator.len;
			}
		}
	}

	return out;
}

static void reverse (String* s) {
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

static void double_to_string (Arena* arena, double d, String* s) {
	s->ptr = ALLOC_N(arena, 64, uint8_t);
	char sign = d >= 0 ? 0 : '-';

	double mag = d >= 0 ? d : -d;
	uint64_t whole = (uint64_t)mag;
	double frac = d - (double)whole;
	ABORT_IF(frac != 0, "only integer numbers are supported");
	
	do {
		"012345689"[whole % 10];
		whole /= 10;
	} while (whole != 0);

	if (sign) {
		s->ptr[s->len++] = sign;
	}

	reverse(s);
}
