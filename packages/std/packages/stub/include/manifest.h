#pragma once
#include <stdint.h>

#include "arena.h"
#include "deserialize.h"
#include "json.h"
#include "table.h"
#include "util.h"

typedef struct {
	uint64_t entrypoint;
	String  executable;
	String	interpreter;
	size_t	num_library_paths;
	String*	library_paths;
	size_t	num_preloads;
	String*	preloads;
	size_t	argc;
	String* argv;
	size_t	interp_argc;
	String*	interp_argv;
	Table	env;
} Manifest;

typedef struct {
	Arena*		arena;
	Manifest*	manifest;
	String		artifacts_dir;
} Cx;

#define ID_VERSION 0
typedef struct  {
	uint8_t version;
	uint8_t padding;
	uint8_t kind;
	uint8_t algorithm;
	uint8_t body[];
} Id;

void parse_manifest (Arena* arena, Manifest* manifest, uint8_t* data, uint64_t len);
void create_manifest_from_value (Cx*, Value* value);
void create_manifest_from_json (Cx*, JsonValue* value);

static void append_to_string (
	String* dst,
	const String* src,
	size_t capacity
) {
	ABORT_IF(dst->len + src->len >= capacity, "out of capacity");
	memcpy(dst->ptr + dst->len, src->ptr, src->len);
	dst->len += src->len;
}

static void append_ch_to_string (
	String* dst,
	char ch,
	size_t capacity
) {
	ABORT_IF(dst->len + 1 >= capacity, "out of capacity");
	dst->ptr[dst->len] = ch;
	dst->len += 1;
}

static void append_id_to_string (String* src, const Bytes* bytes, size_t capacity) {
	if (bytes->len <= 4) ABORT("expected at least four bytes");
	Id* id = (Id*)(bytes->data);

	// Check the version.
	ABORT_IF(id->version != ID_VERSION, "unsupported id version");

	// Check the kind.
	switch(id->kind) {
		case 1: {
			String s = STRING_LITERAL("dir_");
			append_to_string(src, &s, capacity);
			break;
		}
		case 2: {
			String s = STRING_LITERAL("fil_");
			append_to_string(src, &s, capacity);
			break;
		}
		case 3: {
			String s = STRING_LITERAL("sym_");
			append_to_string(src, &s, capacity);
			break;
		}
		default: ABORT("expected an artifact");
	}

	// Version.
	append_ch_to_string(src, id->version + 48, capacity);

	// Algorithm.
	append_ch_to_string(src, id->algorithm + 48, capacity);

	// Base32 encode the rest.
	const char* encoding = "0123456789abcdefghjkmnpqrstvwxyz";
	uint8_t* itr = id->body;
	uint8_t* end = itr + bytes->len - 4;

	uint64_t bits = 0;
	uint64_t count = 0;
	for(; itr != end; itr++) {
		bits = (bits << 8) | *itr;
		count += 8;
		while (count >= 5) {
			char encoded = encoding[(bits >> (count - 5)) & 0x1f];
			append_ch_to_string(src, encoded, capacity);
			count -= 5;
		}
	}
	if (count > 0) {
		char encoded = encoding[(bits << (5  - count)) & 0x1f];
		append_ch_to_string(src, encoded, capacity);
	}
}

static String render_ld_library_path (Arena* arena, Manifest* manifest) {
	String* itr = manifest->library_paths;
	String* end = itr + manifest->num_library_paths;
	String path = {0};

	// Compute the size of the LD_LIBRARY_PATH env var
	size_t len = 0;
	for (; itr != end; itr++) {
		if (itr != manifest->library_paths) {
			len++;
		}
		len += itr->len;
	}

	path.ptr = alloc(arena, len, 1);
	path.len = len;
	itr = manifest->library_paths;

	size_t offset = 0;
	for (; itr != end; itr++) {
		if (itr != manifest->library_paths) {
			path.ptr[offset++] = ':';
		}
		memcpy(path.ptr + offset, itr->ptr, itr->len);
		offset += itr->len;
	}
	return path;
}

static String render_ld_preload (Arena* arena, Manifest* manifest) {
	String* itr = manifest->preloads;
	String* end = itr + manifest->num_preloads;
	String path = {0};

	// Compute the size of the LD_LIBRARY_PATH env var
	size_t len = 0;
	for (; itr != end; itr++) {
		if (itr != manifest->preloads) {
			len++;
		}
		len += itr->len;
	}

	path.ptr = alloc(arena, len, 1);
	path.len = len;
	itr = manifest->preloads;

	size_t offset = 0;
	for (; itr != end; itr++) {
		if (itr != manifest->preloads) {
			path.ptr[offset++] = ':';
		}
		memcpy(path.ptr + offset, itr->ptr, itr->len);
		offset += itr->len;
	}
	return path;
}

static void print_manifest (Manifest* manifest) {
	if (manifest->executable.ptr) {
		trace("executable: %s\n", manifest->executable);
	}
	if (manifest->entrypoint) {
		trace("entrypoint: %s\n", manifest->entrypoint);
	}
	trace("interpreter: %s\n", manifest->interpreter.ptr);
	trace("libary_paths:\n");
	for(int i = 0; i < manifest->num_library_paths; i++) {
		trace("\t");
		for (int n = 0; n < manifest->library_paths[i].len; n++) {
			trace("%c", manifest->library_paths[i].ptr[n]);
		}
		trace("\n");
	}
	trace("preloads:\n");
	for(int i = 0; i < manifest->num_preloads; i++) {
		trace("\t");
		for (int n = 0; n < manifest->preloads[i].len; n++) {
			trace("%c", manifest->preloads[i].ptr[n]);
		}
		trace("\n");
	}
	trace("env:\n");
	for(Node* itr = manifest->env.list; itr != manifest->env.list + manifest->env.capacity; itr++) {
		Node* node = itr;
		while(node) {
			if (node->key.ptr) {
				trace("\t");
				for (int c = 0; c < node->key.len; c++) {
					trace("%c", node->key.ptr[c]);
				}
				trace("=");
				for (int c = 0; c < node->val.len; c++) {
					trace("%c", node->val.ptr[c]);
				}
				trace("\n");
			}
			node = node->next;
		}
	}
}
