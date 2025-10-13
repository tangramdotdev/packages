#pragma once

// Common includes.
#include <elf.h>
#include <linux/unistd.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

// Internals.
#include "syscall.h"

#ifdef __aarch64__
#include "aarch64/util.h"
#endif

#ifdef __x86_64__
#include "x86_64/util.h"
#endif

// Common string type.
typedef struct {
	uint8_t* ptr;
	uint64_t len;
} String;

void* memcpy (void* dst, const void* src, size_t len);
void* memset (void* dst, int c, size_t n);

// Get the length of a string including the null byte.
static size_t strlen_including_nul (const char* str) {
	size_t len = 0;
	for(; str[len]; len++) {}
	len += 1;
	return len;
}

static size_t strlen (const char* s) {
	size_t n = 0;
	for (; s[n]; n++) {}
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
	return !cstr[s.len];
}

static char* cstr (Arena *arena, String s) {
	if (s.ptr[s.len] == 0) {
		return s.ptr;
	}
	char* c = ALLOC_N(arena, s.len + 1, char);
	memcpy((void*)c, s.ptr, s.len);
	return c;
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
	// Compute the max length of the string.
	size_t len = 0;
	for (size_t n = 0; n < nstrings; n++) {
		len += strings[n].len;
		if (n != (nstrings - 1)) {
			len += separator.len;
		}
	}

	// Allocate the new string.
	String out = {0};
	out.ptr = ALLOC_N(arena, len + 1, uint8_t);

	// Append new strings to it.
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
