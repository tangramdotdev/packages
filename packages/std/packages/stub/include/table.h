// Extremely simple string:string hash table.
#pragma once

// Common includes.
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

// Internals.
#include "arena.h"
#include "util.h"

typedef struct Node Node;
struct Node {
	String	key;
	String	val;
	Node*	next;
};

/// @brief  Extremely simple hash table.
typedef struct
{
	Node*	list;
	size_t	capacity;
	size_t 	size;
} Table;

static uint64_t fnv1a (String string) {
	uint64_t hash = 0xcbf29ce484222325;
	const uint8_t* itr = string.ptr;
	const uint8_t* end = string.ptr + string.len;
	for(; itr != end; itr++) {
		hash = hash ^ (uint64_t)*itr;
		hash = hash * 0x100000001b3;
	}
	return hash;
}

static size_t nextpow2 (size_t n) {
	if (n == 0) {
		return 1;
	} else if ((n & (n - 1)) == 0) {
		return n;
	} else {
		return (size_t)(1U << (32 - __builtin_clz((uint32_t)n)));
	}
}

static int create_table (
	Arena* arena,
	Table* table,
	size_t capacity
) {
	capacity = nextpow2(capacity);
	table->list = (Node*)alloc(arena, capacity * sizeof(Node), _Alignof(Node));
	if (!table->list) {
		return -1;
	}
	table->capacity = capacity;
	memset(table->list, 0, capacity * sizeof(Node));
	return 0;
}

static int insert (
	Arena*	arena,
	Table*	table,
	String	key,
	String	val
) {
	// Compute the hash.
	uint64_t hash   = fnv1a(key);

	// Search for the key in the table.
	uint64_t index = hash % table->capacity;
	Node* node = table->list + index;

	for(;;) {
		// If this is an empty node, use it.
		if (node->key.ptr == 0) {
			node->key.ptr = key.ptr;
			node->key.len = key.len;
			node->val.ptr = val.ptr;
			node->val.len = val.len;
			table->size++;
			return 0;
		}

		// If this has the same key, overwrite its value.
		if (streq(node->key, key)) {
			node->val.ptr = val.ptr;
			node->val.len = val.len;
			return 0;
		}
		
		if (node->next) {
			node = node->next;
		} else {
			break;
		}
	}

	// Allocate a new node.
	Node* new_node = ALLOC(arena, Node);
	new_node->key.ptr = key.ptr;
	new_node->key.len = key.len;
	new_node->val.ptr = val.ptr;
	new_node->val.len = val.len;
	new_node->next	= NULL;
	node->next	= new_node;
	table->size++;
	return 0;
}

static void remove (
	Table*	table,
	String	key
) {
	uint64_t hash	= fnv1a(key);
	Node* node	= table->list + hash % table->capacity;
	while(node) {
		if (streq(node->key, key)) {
			node->key.ptr = NULL;
			node->key.len = 0;
			node->val.ptr = NULL;
			node->val.len = 0;
			table->size--;
			return;
		}
		node = node->next;
	}
}

static String lookup (
	Table*	table,
	String	key
) {
	uint64_t hash	= fnv1a(key);
	Node* node	= table->list + hash % table->capacity;
	while(node) {
		if (streq(node->key, key)) {
			return node->val;
		}
		node = node->next;
	}
	String empty = {0};
	return empty;
}

static String clookup (
	Table* table,
	const char* key
) {
	String key_ = STRING_LITERAL(key);
	return lookup(table, key_);
}

static void clear (
	Table* table
) {
	Node* itr = table->list;
	Node* end = itr + table->capacity;
	for(; itr != end; itr++) {
		Node* node = itr;
		while(node) {
			node->key.ptr = NULL;
			node->key.len = 0;
			node = node->next;
		}
	}
}

static void print_table (Table* table) {
	Node* itr = table->list;
	Node* end = itr + table->capacity;
	for(; itr != end; itr++) {
		Node* node = itr;
		while(node) {
			if (node->key.ptr) {
				for (int i = 0; i < node->key.len; i++) {
					trace("%c", node->key.ptr[i]);
				}
				trace(" : ");
				for (int i = 0; i < node->val.len; i++) {
					trace("%c", node->val.ptr[i]);
				}
				trace("\n");
			}
			node = node->next;
		}
	}
}