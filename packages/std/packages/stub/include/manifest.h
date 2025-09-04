// TODO: consistent type checking in the callers before calling sub-parsing functions
// TODO: consistent arg interpretation
// TODO: advanced mutation types.
#pragma once
#include "deserialize.h"
#include "table.h"

enum ManifestField {
	INTERPRETER	= 0,
	EXECUTABLE	= 1,
	ENV		= 2,
	ARGS		= 3
};

typedef struct {
	uint64_t executable;
	String	interpreter;
	size_t	num_library_paths;
	String*	library_paths;
	size_t	num_preloads;
	String*	preloads;
	size_t	argc;
	String* argv;
	Table	env;
} Manifest;

static void append (
	String* dst,
	const String* src,
	size_t capacity
) {
	if (dst->len + src->len >= capacity) ABORT("oom");
	memcpy(dst->ptr + dst->len, src->ptr, src->len);
	dst->len += src->len;
}

static void append_ch (
	String* src,
	char ch,
	size_t capacity
) {
	if (src->len + 1 >= capacity) ABORT("oom");
	src->ptr[src->len] = ch;
	src->len += 1;
}

#define ID_VERSION 0
typedef struct  {
	uint8_t version;
	uint8_t padding;
	uint8_t kind;
	uint8_t algorithm;
	uint8_t body[];
} Id;

static void append_id (String* src, const Bytes* bytes, size_t capacity) {
	if (bytes->len <= 4) ABORT("expected at least four bytes");
	Id* id = (Id*)(bytes->data);

	// Check the version.
	ABORT_IF(id->version != ID_VERSION, "unsupported id version");

	// Check the kind.
	switch(id->kind) {
		case 1: {
			String s = STRING_LITERAL("dir_");
			append(src, &s, capacity);
			break;
		}
		case 2: {
			String s = STRING_LITERAL("fil_");
			append(src, &s, capacity);
			break;
		}
		case 3: {
			String s = STRING_LITERAL("sym_");
			append(src, &s, capacity);
			break;
		}
		default: ABORT("expected an artifact");
	}

	// Version.
	append_ch(src, id->version + 48, capacity);

	// Algorithm.
	append_ch(src, id->algorithm + 48, capacity);

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
			append_ch(src, encoded, capacity);
			count -= 5;
		}
	}
	if (count > 0) {
		char encoded = encoding[(bits << (5  - count)) & 0x1f];
		append_ch(src, encoded, capacity);
	}
}

static void render_template (
	const Value* template,
	Arena* arena,
	const String* artifacts_dir,
	String* rendered
) {
	ABORT_IF(template->kind != STRUCT, "expected a struct")

	Value* components = NULL;
	{
		Field* itr = template->value._struct.fields;
		Field* end = itr + template->value._struct.len;
		for(; itr != end; itr++) {
			switch (itr->id) {
				case 0: {
					components = itr->value;
					break;
				}
				default: break;
			}
		}
	}
	if (!components) {
		ABORT("expected components");
	}
	if (components->kind != ARRAY) ABORT("expected an array");
	Value* itr = components->value._array.data;
	Value* end = itr + components->value._array.len;
	size_t capacity = 2048;
	rendered->ptr = alloc(arena, 2048, 1);
	rendered->len = 0;
	if(!rendered->ptr) ABORT("oom");
	for(; itr != end; itr++) {
		if (itr->kind != ENUM) ABORT("expected an enum");
		switch(itr->value._enum.id) {
			case 0: {
				if (itr->value._enum.value->kind != STRING) ABORT("expected a string");
				String* string = &itr->value._enum.value->value._string;
				append(rendered, string, capacity);
				continue;
			}
			case 1: {
				if (itr->value._enum.value->kind != BYTES) ABORT("expected a byte string");
				append(rendered, artifacts_dir, capacity);
				append_ch(rendered, '/', capacity);
				append_id(rendered, &itr->value._enum.value->value._bytes, capacity);
				continue;
			}
			default: continue;
		}
	}
}

static void parse_loader_paths (
	const String* artifacts_dir,
	Deserializer* de,
	Manifest* manifest,
	Value* value
) {
	if (!value) { return; }
	if (value->kind != ARRAY) ABORT("expected an array");
	uint64_t len = value->value._array.len;

	// Allocate space for the paths.
	manifest->library_paths = (String*)alloc(de->arena, len * sizeof(String), _Alignof(String));
	manifest->num_library_paths = len;

	// Render each template.
	Value* template = value->value._array.data;
	for(size_t n = 0; n < len; n++) {
		render_template(&template[n], de->arena, artifacts_dir, &manifest->library_paths[n]);
	}

}

static void parse_preloads (
	const String* artifacts_dir,
	Deserializer* de,
	Manifest* manifest,
	Value* value
) {
	if (!value) { return; }
	if (value->kind != ARRAY) ABORT("expected an array");
	uint64_t len = value->value._array.len;

	// Allocate space for the paths.
	manifest->preloads = (String*)alloc(de->arena, len * sizeof(String), _Alignof(String));
	manifest->num_preloads = len;

	// Render each template.
	Value* template = value->value._array.data;
	for(size_t n = 0; n < len; n++) {
		render_template(&template[n], de->arena, artifacts_dir, &manifest->preloads[n]);
	}
}

static void parse_interpreter (
	const String* artifacts_dir,
	Deserializer* de,
	Manifest* manifest,
	Value* value
) {
	if (value->kind != OPTION) ABORT("expected an option");
	if (!value->value._option) return;
	value = value->value._option;
	if (value->kind != ENUM) ABORT("expected an enum");
	switch(value->value._enum.id) {
		case 1:
		case 2: {
			value = value->value._enum.value;
			break;
		}
		default: ABORT("unknown interpeter");
	}
	if (value->kind != STRUCT) ABORT("failed to parse interpreter: expected a struct");
	Field* itr = value->value._struct.fields;
	Field* end = itr + value->value._struct.len;
	for(; itr != end; itr++) {
		switch(itr->id) {
			case 0: {
				Value* template = itr->value;
				render_template(template, de->arena, artifacts_dir, &manifest->interpreter);
				DBG("got interpreter: %s\n", manifest->interpreter);
				continue;
			}
			case 1: {
				if (itr->value->kind != OPTION) ABORT("expected an option");
				parse_loader_paths(artifacts_dir, de, manifest, itr->value->value._option);
				continue;
			}
			case 2: {
				if (itr->value->kind != OPTION) ABORT("expected an option");
				parse_preloads(artifacts_dir, de, manifest, itr->value->value._option);
			}
			default: continue;
		}
	}
}

static String render_value (
	Arena*	arena,
	const String* artifacts_dir,
	Enum*	value
) {
	String rendered = {0};
	DBG("rendering value with id: %d\n", value->id);
	switch(value->id) {
		// Null
		case 0: return rendered;
		// Bool
		case 1: {
			ABORT_IF(value->value->kind != BOOL, "expected a bool");
			rendered.ptr = value->value->value._bool ? "true" : "false";
			rendered.len = strlen(rendered.ptr);
			break;
		}
		// Number
		case 2: ABORT("todo: numbers");
		// String
		case 3: {
			ABORT_IF(value->value->kind != STRING, "expected a string");
			rendered.ptr = value->value->value._string.ptr;
			rendered.len = value->value->value._string.len;
			break;
		}
		case 4: ABORT("todo: array");
		case 6: ABORT("todo: object");
		case 7: ABORT("todo: bytes");
		case 8: ABORT("todo: mutation");
		// Template
		case 9: {
			render_template(value->value, arena, artifacts_dir, &rendered);
			break;
		}
		default: ABORT("malformed env manifest");
	}
	return rendered;
}

static void apply_value_to_key (
	Arena* arena,
	const String* artifacts_dir,
	Manifest* manifest,
	String* key,
	Enum* val
) {
	if (val->id == 4 || val->id == 8) {
		ABORT("todo: array/mutation handling");
	}
	String rendered = render_value(
		arena,
		artifacts_dir,
		val
	);
	insert(arena, &manifest->env, *key, rendered);
}

static void apply_mutation_to_key (
	Arena* arena,
	const String* artifacts_dir,
	Manifest* manifest,
	String* key,
	Enum* mutation
) {
	switch(mutation->id) {
		// UNSET
		case 0: {
			remove(&manifest->env, *key);
			break;
		}
		// SET
		case 1: {
			if (mutation->value->kind != ENUM) { ABORT("expected an enum"); }
			apply_value_to_key(arena, artifacts_dir, manifest, key, &mutation->value->value._enum);
			break;
		}
		// SET IF UNSET
		case 2: {
			if (lookup(&manifest->env, *key).ptr) {
				if (mutation->value->kind != ENUM) { ABORT("expected an enum"); }
				apply_value_to_key(arena, artifacts_dir, manifest, key, &mutation->value->value._enum);
			}
			break;
		}
		// PREPEND
		case 3:
		// APPEND
		case 4:
		// PREFIX
		case 5:
		// SUFFIX
		case 6: ABORT("unimplemented"); // TODO
		// MERGE
		case 7:
		default: ABORT("unsupported mutation type");
	}
}

static void apply_env (
	Arena* arena,
	const String* artifacts_dir,
	Manifest* manifest,
	Map* env
) {
	for (size_t n = 0; n < env->len; n++) {
		if (env->keys[n].kind != STRING) { ABORT("expected a string"); }
		if (env->vals[n].kind != ENUM) { ABORT("expected an enum"); }
		String* key = &env->keys[n].value._string;
		Enum*   val = &env->vals[n].value._enum;
		switch (val->id) {
			// ARRAY:
			case 4: {
				if (val->value->kind != ARRAY) { ABORT("expected an array"); }
				Value* itr = val->value->value._array.data;
				Value* end = itr + val->value->value._array.len;
				for (; itr != end; itr++) {
					if (itr->kind != ENUM) { ABORT("expected an enum"); }
					apply_mutation_to_key(arena, artifacts_dir, manifest, key, &itr->value._enum);
				}
				break;
			}
			// MUTATION
			case 8: {
				if (val->value->kind != ENUM) { ABORT("expected an enum"); }
				apply_mutation_to_key(arena, artifacts_dir, manifest, key, &val->value->value._enum);
				break;
			}
			// Everything else
			default: {
				if (val->value->kind != ENUM) { ABORT("expected an enum"); }
				apply_value_to_key(arena, artifacts_dir, manifest, key, &val->value->value._enum);
				break;
			}
		}
	}
}

static void parse_executable (
	const String* artifacts_dir,
	Deserializer* de,
	Manifest* manifest,
	Value* value
) {
	ABORT_IF(value->kind != ENUM, "expected an executable");
	Enum executable = value->value._enum;
	ABORT_IF(executable.id != 2, "expected an address");
	ABORT_IF(executable.value->kind != UVARINT, "expected an integer");
	manifest->executable = executable.value->value._uvarint;
}

static void parse_env (
	const String* artifacts_dir,
	Deserializer* de,
	Manifest* manifest,
	Value* value
) {
	ABORT_IF(value->kind != OPTION, "expected an option");
	value = value->value._option;
	if (!value) {
		return;
	}
	ABORT_IF(value->kind != ENUM, "expected an enum");
	Enum mutation = value->value._enum;
	switch(mutation.id) {
		// UNSET
		case 0: {
			clear(&manifest->env);
			break;
		}
		// SET
		case 1: {
			DBG("mutation: \n");
			ABORT_IF(mutation.value->kind != ENUM, "expected a value");
			Enum inner = mutation.value->value._enum;
			ABORT_IF(inner.id != 5 || inner.value->kind != MAP, "expected a map");
			Map* map = &inner.value->value._map;
			apply_env(de->arena, artifacts_dir, manifest, map);
			break;
		}
		// todo: merge
		// ignore anything else. TODO: error?
		default: {
			return;
		}
	}
}

static void parse_arg (
	const String* artifacts_dir,
	Deserializer* de,
	Manifest* manifest,
	Value* value
) {
	ABORT_IF(value->kind != OPTION, "expected an option");
	value = value->value._option;
	if (!value) {
		return;
	}
	ABORT_IF(value->kind != ARRAY, "expected an array");
	Array* array = &value->value._array;
	uint64_t len = array->len;
	manifest->argc = (int)len;
	manifest->argv = ALLOC_N(de->arena, len, String);
	for(int n = 0; n < len; n++) {
		Value* itr = array->data + n;
		String* arg = manifest->argv + n;
		render_template(itr, de->arena, artifacts_dir, arg);
	}
}

static void find_artifacts_dir (Arena* arena, String* path) {
	// Get cwd.
	path->ptr = alloc(arena, 2048, 1);
	if(getcwd(path->ptr, 2048 - 19) <= 0) ABORT("getcwd failed");
	path->len = strlen(path->ptr);
	for(;;) {
		// Append /.tangram/artifacts to the path.
		memcpy(path->ptr + path->len, "/.tangram/artifacts", 20);
		stat_t statbuf;
		if (stat(path->ptr, &statbuf) == 0) {
			path->len += 19;
			break;
		}
		path->ptr[path->len] = 0;
		*path = parent_dir(path);
		ABORT_IF(path->len == 0, "missing artifacts dir");
		continue;
	}
}

static String ld_library_path (Arena* arena, Manifest* manifest) {
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

static String ld_preload (Arena* arena, Manifest* manifest) {
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

static void parse_manifest (
	void* data,
	size_t sz,
	Manifest* manifest,
	Arena* arena
) {
	// Create the deserializer.
	Deserializer de = {
		.arena	= arena,
		.cursor	= 0,
		.data	= (uint8_t*)data,
		.len	= sz
	};

	// Find the artifacts directory.
	String artifacts_dir;
	find_artifacts_dir(de.arena, &artifacts_dir);

	// Deserialize the manifest.
	Value value;
	int ret = deserialize_value(&de, &value);
	ABORT_IF(ret != OK, "failed to deserialize the manifest: %s", deserializer_error(ret));
	ABORT_IF(value.kind != STRUCT, "expected a struct");

	// Parse fields.
	Field* itr = value.value._struct.fields;
	Field* end = itr + value.value._struct.len;
	for (; itr != end; itr++) {
		switch (itr->id) {
			case INTERPRETER: {
				parse_interpreter(&artifacts_dir, &de, manifest, itr->value);
				continue;
			}
			case EXECUTABLE: {
				// TODO
				// parse_executable(&artifacts_dir, &de, manifest, itr->value);
				continue;
			}
			case ENV: {
				parse_env(&artifacts_dir, &de, manifest, itr->value);
				continue;
			}
			case ARGS: {
				parse_arg(&artifacts_dir, &de, manifest, itr->value);
				continue;
			}
			default: continue;
		}
	}
	String path = ld_library_path(arena, manifest);
	if (path.ptr) {
		DBG("LD_LIBRARY_PATH=%s\n", path.ptr);
		String key = STRING_LITERAL("LD_LIBRARY_PATH");
		insert(arena, &manifest->env, key, path);
	}
	String preload = ld_preload(arena, manifest);
	if (preload.ptr) {
		DBG("LD_PRELOAD: %s\n", preload.ptr);
		String key = STRING_LITERAL("LD_PRELOAD");
		insert(arena, &manifest->env, key, preload);
	}
}

static void print_manifest (Manifest* manifest) {
	DBG("interprter: %s\n", manifest->interpreter.ptr);
	DBG("libary_paths:\n");
	for(int i = 0; i < manifest->num_library_paths; i++) {
		DBG("\t");
		for (int n = 0; n < manifest->library_paths[i].len; n++) {
			DBG("%c", manifest->library_paths[i].ptr[n]);
		}
		DBG("\n");
	}
	DBG("preloads:\n");
	for(int i = 0; i < manifest->num_preloads; i++) {
		DBG("\t");
		for (int n = 0; n < manifest->preloads[i].len; n++) {
			DBG("%c", manifest->preloads[i].ptr[n]);
		}
		DBG("\n");
		DBG("\t%s\n", manifest->preloads[i].ptr);
	}
	for(Node* itr = manifest->env.list; itr != manifest->env.list + manifest->env.capacity; itr++) {
		Node* node = itr;
		while(node) {
			if (node->key.ptr) {
				for (int c = 0; c < node->key.len; c++) {
					DBG("%c", node->key.ptr[c]);
				}
				DBG("=");
				for (int c = 0; c < node->val.len; c++) {
					DBG("%c", node->val.ptr[c]);
				}
				DBG("\n");
			}
			node = node->next;
		}
	}
}
