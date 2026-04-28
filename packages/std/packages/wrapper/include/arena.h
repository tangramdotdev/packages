#pragma once
#include <stddef.h>
#include "common.h"
#include "debug.h"
#include "util.h"

// Compile with -DSTDLIB for debugging only.
#ifdef STDLIB
	#define _GNU_SOURCE
	#include <sys/mman.h>
	#include <stdio.h>
#else
	#include "syscall.h"
#endif

// Number of pages per segment in the arena.
#define DEFAULT_NUM_PAGES 16

// 1 GiB max
#define MAX_NUM_PAGES 0x40000

// Helper to allocate a single T.
#define ALLOC(arena, T) \
	(T*)alloc(arena, sizeof(T), _Alignof(T))

// Helper to allocate an array of n T.
#define ALLOC_N(arena, n, T) \
	(T*)alloc(arena, ((size_t)(n)) * sizeof(T), _Alignof(T))

// Helper to align `m` to `n`.
#define ALIGN(m, n) \
	(((m) + (n) - 1) & ~((n) - 1))

typedef struct Segment Segment;
typedef struct Arena Arena;

struct Arena {
	Segment* segment;
	uint64_t num_pages;
	uint64_t page_size;
};

struct Segment {
	uint64_t offset;
	uint64_t length;
	Segment* next_segment;
	uint8_t  memory[];
};

TG_VISIBILITY void create_arena (Arena* arena, uint64_t page_size);
TG_VISIBILITY void destroy_arena (Arena* arena);
TG_VISIBILITY void* alloc (Arena* arena, size_t size, size_t alignment);
TG_VISIBILITY void add_segment (Arena* arena, size_t num_pages);

// util methods that require allocation are defined here.
TG_VISIBILITY char* cstr (Arena *arena, String s);
TG_VISIBILITY String join (Arena* arena, String separator, String* strings, size_t nstrings);
TG_VISIBILITY void double_to_string (Arena* arena, double d, String* s);
TG_VISIBILITY String executable_path (Arena* arena);

#ifdef TG_IMPLEMENTATION
TG_VISIBILITY void create_arena (Arena* arena, uint64_t page_size) {
	arena->num_pages = 0;
	arena->segment = NULL;
	arena->page_size = page_size;
	add_segment(arena, DEFAULT_NUM_PAGES);
}

TG_VISIBILITY void destroy_arena (Arena* arena) {
	Segment* current = arena->segment;
	while(current) {
		// Save the next segment.
		Segment* next = current->next_segment;

		// Sanity check to detect corruption of the segment itself.
		ABORT_IF((current->length % arena->page_size) != 0, "internal error: corrupted segment");

		// Unmap and error if it fails.
		int ec = munmap((void*)current, current->length);
		ABORT_IF(ec != 0, "internal error: munmap failed (addr=0x%lx, len=0x%lx)", (uintptr_t)current, (uintptr_t)current->length);

		// Update the current segment.
		current = next;
	}
}

TG_VISIBILITY void* alloc (Arena* arena, size_t size, size_t alignment) {
	// Sanity check.
	ABORT_IF((size % alignment) != 0, "internal error: misaligned allocation");

	// Compute start/end of the allocation.
	size_t start = ALIGN(arena->segment->offset, alignment);
	size_t end = start + size;

	// Check if we need to add more space.
	if (end > arena->segment->length) {
		// Compute the minimum number of pages required by the allocation.
		size_t min_size = ALIGN(ALIGN(sizeof(Segment), alignment) + size, arena->page_size);
		size_t min_num_pages = min_size / arena->page_size;

		// The number of pages we use is the MAX(min_num_pages, DEFAULT_NUM_PAGES).
		size_t num_pages = min_num_pages < DEFAULT_NUM_PAGES ? DEFAULT_NUM_PAGES : min_size;

		// Add a new segment.
		add_segment(arena, num_pages);

		// Update start/end range of the allocation, as it will have changed.
		start = ALIGN(arena->segment->offset, alignment);
		end = start + size;

		ABORT_IF(end > arena->segment->length, "internal error: failed to allocate enough space");
	}

	// Allocate.
	uintptr_t pointer = (uintptr_t)arena->segment + start;
	arena->segment->offset = end;

	// Return the allocated pointer.
	return (void*)pointer;
}

TG_VISIBILITY void add_segment (Arena* arena, size_t num_pages) {
	// Sanity check.
	ABORT_IF(num_pages == 0, "internal: invalid argument");

	// Compute the segment data.
	size_t length = num_pages * arena->page_size;
	size_t offset = sizeof(Segment);
	Segment* next_segment = arena->segment;

	// Allocate a new segment.
	Segment* segment = (Segment*)mmap(
		NULL,
		length,
		PROT_READ | PROT_WRITE,
		MAP_ANONYMOUS | MAP_PRIVATE,
		-1,
		0
	);
	ABORT_IF((void*)segment == MAP_FAILED, "internal: mmap failed");

	// Update the segment.
	segment->length = length;
	segment->offset = offset;
	segment->next_segment = next_segment;

	// Update the arena.
	arena->segment = segment;
	arena->num_pages += num_pages;
	ABORT_IF(arena->num_pages >= MAX_NUM_PAGES, "internal error: OOM");
}

TG_VISIBILITY String join (Arena* arena, String separator, String* strings, size_t nstrings) {
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
	bool first = true;
	for (size_t n = 0; n < nstrings; n++) {
		if (strings[n].ptr) {
			if (!first && separator.ptr)  {
				memcpy(out.ptr + out.len, separator.ptr, separator.len);
				out.len += separator.len;
			}
			first = false;
			memcpy(out.ptr + out.len, strings[n].ptr, strings[n].len);
			out.len += strings[n].len;
		}
	}

	return out;
}

TG_VISIBILITY void u64_to_string (Arena* arena, uint64_t d, String* s) {
	s->ptr = ALLOC_N(arena, 64, uint8_t);
	do {
		append_ch_to_string(s, "012345689"[d % 10], 64);
		d /= 10;
	} while (d != 0);
	reverse(s);
}

TG_VISIBILITY void double_to_string (Arena* arena, double d, String* s) {
	s->ptr = ALLOC_N(arena, 64, uint8_t);
	char sign = d >= 0 ? 0 : '-';

	double mag = d >= 0 ? d : -d;
	uint64_t whole = (uint64_t)mag;
	double frac = d - (double)whole;
	ABORT_IF(frac != 0, "only integer numbers are supported");
	
	do {
		append_ch_to_string(s, "012345689"[whole % 10], 64);
		whole /= 10;
	} while (whole != 0);

	if (sign) {
		s->ptr[s->len++] = sign;
	}

	reverse(s);
}

TG_VISIBILITY char* cstr (Arena *arena, String s) {
	if (s.ptr[s.len] == 0) {
		return (char*)s.ptr;
	}
	char* c = ALLOC_N(arena, s.len + 1, char);
	memcpy((void*)c, s.ptr, s.len);
	return c;
}
#define PATH_MAX 4096
#ifdef __APPLE__
	extern int _NSGetExecutablePath(char* buf, uint32_t* bufsize);
#endif
TG_VISIBILITY String executable_path (Arena* arena) {
	String path;
#ifdef __linux__
	path.ptr = "/proc/self/exe";
	path.len = tg_strlen(path.ptr);
#elif defined(__APPLE__)
	path.ptr = ALLOC_N(arena, 256, uint8_t);
	uint32_t size = 255;
	int ret = _NSGetExecutablePath((char*)path.ptr, &size);
	if (ret == -1) {
		path.ptr = ALLOC_N(arena, size + 1, uint8_t);
		ABORT_IF(_NSGetExecutablePath((char*)path.ptr, &size) != 0, "failed to get executable path");
	}
	path.len = (uint64_t)size + 1;
#else
#error "unsupported target"
#endif
	return path;
}
#endif
