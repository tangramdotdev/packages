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

// AFAIK, this is true everywhere? Technically this could be set anywhere.
#define PAGE_SZ 4096

// Number of pages per segment in the arena.
#define NUM_PAGES 256

// Helper to allocate a single T
#define ALLOC(arena, T) (T*)alloc(arena, sizeof(T), _Alignof(T))

// Helper to allocate an array of n T.
#define ALLOC_N(arena, n, T) (T*)alloc(arena, ((size_t)(n)) * sizeof(T), _Alignof(T))

// Helper to align `m` to `n`. 
#define ALIGN(m, n) (((m) + (n) - 1) & ~((n) - 1))

// A single segment in the arena. Segments form a linked list.
typedef struct Segment Segment;
struct Segment {
	Segment* next;
	uint8_t	 memory[];
};

// Arena state.
typedef struct {
	Segment* segment;
	size_t offset;
} Arena;

// Initialize the arena.
static int create_arena (Arena* arena) {
	arena->segment = (Segment*)mmap(
		NULL, 
		PAGE_SZ * NUM_PAGES, 
		PROT_READ | PROT_WRITE, 
		MAP_ANONYMOUS | MAP_PRIVATE, 
		-1, 
		0
	);
	ABORT_IF((void*)arena->segment == MAP_FAILED, "mmap failed");
	arena->offset = sizeof(Segment*);
	arena->segment->next = NULL;
	return 0;
}

// Destroy the arena.
static void destroy_arena (Arena* arena) {
	Segment* curr = arena->segment;
	while(curr) {
		Segment* next = curr->next;
		munmap((void*)curr, PAGE_SZ * NUM_PAGES);
		curr = next;
	}
}

// Allocate aligned memory.
static void* alloc (Arena* arena, size_t size, size_t alignment) {
	for(;;) {
		size_t start = ALIGN(arena->offset, alignment);
		size_t end   = start + size;
		if (end < (PAGE_SZ * NUM_PAGES)) {
			arena->offset = end;
			return (char*)arena->segment + start;
		}
		Segment* old = arena->segment;
		if (create_arena(arena)) {
			return NULL;
		}
		arena->segment->next = old;
	}
}
