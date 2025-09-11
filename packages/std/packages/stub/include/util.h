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

static String parent_dir (const String* path) {
	String parent;
	memcpy(&parent, path, sizeof(String));
	for (; parent.len; parent.len--) {
		if (parent.ptr[parent.len] == '/') {
			break;
		}
	}
	return parent;
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