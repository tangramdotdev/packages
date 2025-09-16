// Extremely minimal arena allocator.
#pragma once
#include <stddef.h>
#include "debug.h"

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

// Helper to allocate a single T
#define ALLOC(arena, T) (T*)alloc(arena, sizeof(T), _Alignof(T))

// Helper to allocate an array of n T.
#define ALLOC_N(arena, n, T) (T*)alloc(arena, ((size_t)(n)) * sizeof(T), _Alignof(T))

// Helper to align `m` to `n`.
#define ALIGN(m, n) (((m) + (n) - 1) & ~((n) - 1))
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

static void create_arena (Arena* arena, uint64_t page_size);
static void destroy_arena (Arena* arena);
static void* alloc (Arena* arena, size_t size, size_t alignment);
static void add_segment (Arena* arena, size_t num_pages);

static void create_arena (Arena* arena, uint64_t page_size) {
	arena->num_pages = 0;
	arena->segment = NULL;
	arena->page_size = page_size;
	add_segment(arena, DEFAULT_NUM_PAGES);
}

static void destroy_arena (Arena* arena) {
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

static void* alloc (Arena* arena, size_t size, size_t alignment) {
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

static void add_segment (Arena* arena, size_t num_pages) {
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
