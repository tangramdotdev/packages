#pragma once
#include <stdint.h>

#include "common.h"
#include "arena.h"
#include "footer.h"
#include "json.h"
#include "table.h"
#include "util.h"

enum {
	INTERPRETER_KIND_NORMAL,
	INTERPRETER_KIND_LD_LINUX,
	INTERPRETER_KIND_LD_MUSL,
	INTERPRETER_KIND_DYLD
};

typedef struct {
	uint64_t 	entrypoint;
	String	 	executable;
	String		interpreter;
	uint64_t	interpreter_kind;
	size_t		num_library_paths;
	String*		library_paths;
	size_t		num_preloads;
	String*		preloads;
	size_t		argc;
	String*		argv;
	size_t		interp_argc;
	String*		interp_argv;
	String 		ld_library_path;
	String 		ld_preload;
	Table		env;
	String		raw;
} Manifest;


typedef struct {
	Arena*		arena;
	Manifest*	manifest;
	String		artifacts_dir;
	bool		enable_tracing;
} Cx;

#define ID_VERSION 0

#ifdef __linux__
#define LD_LIBRARY_PATH "LD_LIBRARY_PATH"
#define LD_PRELOAD "LD_PRELOAD"
#endif

#ifdef __APPLE__
#define LD_LIBRARY_PATH "DYLD_LIBRARY_PATH"
#define LD_PRELOAD "DYLD_INSERT_LIBRARIES"
#endif


typedef struct  {
	uint8_t version;
	uint8_t padding;
	uint8_t kind;
	uint8_t algorithm;
	uint8_t body[];
} Id;

// api
TG_VISIBILITY void parse_manifest (Arena* arena, Manifest* manifest, bool enable_tracing, uint8_t* data, uint64_t len);
TG_VISIBILITY void parse_manifest_from_json (Cx*, JsonValue* value);
TG_VISIBILITY String render_ld_library_path (Arena* arena, Manifest* manifest);
TG_VISIBILITY String render_ld_preload (Arena* arena, Manifest* manifest);
TG_VISIBILITY void print_manifest (Manifest* manifest);

// internals
TG_VISIBILITY void parse_manifest_interpreter (Cx* cx, JsonValue* interpeter);
TG_VISIBILITY void parse_manifest_executable (Cx* cx, JsonValue* executable);
TG_VISIBILITY void parse_manifest_env (Cx* cx, JsonValue* env);
TG_VISIBILITY void parse_manifest_args (Cx* cx, JsonValue* args);
TG_VISIBILITY void parse_manifest_preloads (Cx* cx, JsonValue* value);
TG_VISIBILITY void parse_manifest_interpreter_args (Cx* cx, JsonValue* value);
TG_VISIBILITY void parse_manifest_loader_paths (Cx* cx, JsonValue* value);
TG_VISIBILITY void apply_env(Cx* cx, JsonObject* map);
TG_VISIBILITY void apply_mutation_to_key (Cx* cx, String* key, JsonObject* mutation);
TG_VISIBILITY void apply_value_to_key (Cx* cx, String* key, JsonValue* val);
TG_VISIBILITY void render_template (Cx* cx, JsonValue* template, String* dst);
TG_VISIBILITY void render_content_executable (Cx* cx, JsonValue* template);
TG_VISIBILITY String render_value (Cx* cx, JsonValue* value);
TG_VISIBILITY String render_object (Cx* cx, JsonValue* value);

#ifdef TG_IMPLEMENTATION
#define ARTIFACTS_DIR "/.tangram/artifacts"
#define ARTIFACTS_DIR_LEN 19
#define OPT_ARTIFACTS_DIR "/opt/tangram/artifacts"
#define OPT_ARTIFACTS_DIR_LEN 22

TG_VISIBILITY void find_artifacts_dir (Arena* arena, String* path) {
	struct stat statbuf;

	// First check the root.
	if (stat(ARTIFACTS_DIR, &statbuf) == 0) {
		path->ptr = (uint8_t*)ARTIFACTS_DIR;
		path->len = ARTIFACTS_DIR_LEN;
		return;
	}

	if (stat(OPT_ARTIFACTS_DIR, &statbuf) == 0) {
		path->ptr = (uint8_t*)OPT_ARTIFACTS_DIR;
		path->len = OPT_ARTIFACTS_DIR_LEN;
		return;
	}

	// Get the parent directory of the current executable.
	*path = executable_path(arena);
	*path = parent_dir(*path);

	// Walk the parent directory tree.
	do {
		path->ptr[path->len] = 0;
		memcpy(path->ptr + path->len, ARTIFACTS_DIR, ARTIFACTS_DIR_LEN + 1);
		if (stat((char*)path->ptr, &statbuf) == 0) {
			path->len += ARTIFACTS_DIR_LEN;
			break;
		}
		*path = parent_dir(*path);
	} while (path->len > 0);
	ABORT_IF(!path->ptr, "failed to find artifacts directory");
}

TG_VISIBILITY void parse_manifest (
	Arena*		arena,
	Manifest*	manifest,
	bool		enable_tracing,
	uint8_t*	data,
	uint64_t	len
) {
	// Sanity check.
	ABORT_IF(len == 0, "expected a non-zero length");

	// Find the artifacts directory.
	String artifacts_dir;
	find_artifacts_dir(arena, &artifacts_dir);
	if (enable_tracing) {
		trace("artifacts directory:");
		print_json_string(&artifacts_dir);
		trace("\n");
	}

	// Create the context.
	Cx cx = {
		.arena = arena,
		.manifest = manifest,
		.artifacts_dir = artifacts_dir,
		.enable_tracing = enable_tracing
	};

	if (cx.enable_tracing) {
		trace("\"");
		for (int n = 0; n < len; n++) {
			trace("%c", data[n]);
		}
		trace("\"\n");
	}

	// Parse json.
	JsonParser parser = {
		.arena = arena,
		.input = {
			.ptr = data,
			.len = len
		},
	};
	JsonValue value;
	int ret = parse_json_value(&parser, &value);
	if (ret != ERROR_OK) {
		const char* message = json_error_message(ret);
		ABORT("failed to parse json: %s", message);
	}

	if (cx.enable_tracing) {
		trace("parsed manifest json\n");
	}
	parse_manifest_from_json(&cx, &value);
	if (cx.enable_tracing) {
		trace("parsed manifest\n");
	}
	manifest->ld_library_path = render_ld_library_path(arena, manifest);
	manifest->ld_preload = render_ld_preload(arena, manifest);
	manifest->raw.ptr = data;
	manifest->raw.len = len;
}

TG_VISIBILITY String render_ld_library_path (Arena* arena, Manifest* manifest) {
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

TG_VISIBILITY String render_ld_preload (Arena* arena, Manifest* manifest) {
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

TG_VISIBILITY void print_manifest (Manifest* manifest) {
	uint8_t* ptr = manifest->raw.ptr;
	uint64_t len = manifest->raw.len;
	while (len > 0 && ptr) {
		int64_t amt = write(STDOUT_FILENO, (void*)ptr, len);
		if (amt <= 0) {
			break;
		}
		ptr += amt;
		len -= amt;
	}
}

TG_VISIBILITY void parse_manifest_from_json (Cx* cx, JsonValue* value) {
	// Validate.
	ABORT_IF(value->kind != JSON_OBJECT, "expected an object");

	// Parse fields.
	JsonObject* object = &value->value._object;
	while(object) {
		if (object->value && object->value->kind != JSON_NULL) {
			if (cstreq(object->key, "interpreter")) {
				parse_manifest_interpreter(cx, object->value);
				if (cx->enable_tracing) {
					trace("parsed interpreter\n");
				}
			} else if (cstreq(object->key, "executable")) {
				parse_manifest_executable(cx, object->value);
				if (cx->enable_tracing) {
					trace("parsed executable\n");
				}
			} else if (cstreq(object->key, "env")) {
				parse_manifest_env(cx, object->value);
				if (cx->enable_tracing) {
					trace("parsed env\n");
				}
			} else if (cstreq(object->key, "args")) {
				parse_manifest_args(cx, object->value);
				if (cx->enable_tracing) {
					trace("parsed args\n");
				}
			}
		}
		object = object->next;
	}
}

TG_VISIBILITY void parse_manifest_interpreter (Cx* cx, JsonValue* value) {
	ABORT_IF(value->kind != JSON_OBJECT, "expected an object, got %d", value->kind);
	JsonObject* object = &value->value._object;
	JsonValue* kind = json_get(object, "kind");
	ABORT_IF(!kind, "expected a kind string");
	ABORT_IF(kind->kind != JSON_STRING, "expected a string");
	if (cstreq(kind->value._string, "normal")) {
		cx->manifest->interpreter_kind = INTERPRETER_KIND_NORMAL;
	} else if (cstreq(kind->value._string, "ld-linux")) {
		cx->manifest->interpreter_kind = INTERPRETER_KIND_LD_LINUX;
	} else if (cstreq(kind->value._string, "ld-musl")) {
		cx->manifest->interpreter_kind = INTERPRETER_KIND_LD_MUSL;
	} else if (cstreq(kind->value._string, "dyld")) {
		cx->manifest->interpreter_kind = INTERPRETER_KIND_DYLD;
	} else {
		char* s = cstr(cx->arena, kind->value._string);
		ABORT("unknown interpreter kind %s", s);
	}
	if (cx->enable_tracing) {
		trace("parsed interpreter kind\n");
	}
	JsonValue* path = json_get(object, "path");
	JsonValue* library_paths = json_get(object, "libraryPaths");
	JsonValue* preloads = json_get(object, "preloads");
	JsonValue* args = json_get(object, "args");
	if (cx->manifest->interpreter_kind == INTERPRETER_KIND_NORMAL 
	||  cx->manifest->interpreter_kind == INTERPRETER_KIND_LD_LINUX 
	||  cx->manifest->interpreter_kind == INTERPRETER_KIND_LD_MUSL) {
		ABORT_IF(!path, "expected a path for the interpreter");
	}
	if (path) {
		render_template(cx, path, &cx->manifest->interpreter);
	}
	parse_manifest_loader_paths(cx, library_paths);
	if (cx->enable_tracing) {
		trace("parsed loader paths\n");
	}
	parse_manifest_preloads(cx, preloads);
	if (cx->enable_tracing) {
		trace("parsed interpreter preloads\n");
	}
	parse_manifest_interpreter_args(cx, args);
	if (cx->enable_tracing) {
		trace("parsed interpreter args\n");
	}
}

TG_VISIBILITY void parse_manifest_loader_paths (Cx* cx, JsonValue* value) {
	// Type check.
	if (!value) { return; }
	ABORT_IF(value->kind != JSON_ARRAY, "expected an array");
	JsonArray* array = &value->value._array;

	// Count entries.
	uint64_t len = json_array_len(array);

	// Reset.
	array = &value->value._array;

	// Allocate space for the paths.
	cx->manifest->library_paths = ALLOC_N(cx->arena, len, String);	cx->manifest->num_library_paths = len;

	// Render each template.
	for(size_t n = 0; n < len; n++) {
		JsonValue* template = array->value;
		render_template(cx, template, &cx->manifest->library_paths[n]);
		array = array->next;
	}
}

TG_VISIBILITY void parse_manifest_preloads (Cx* cx, JsonValue* value) {
	// Type check.
	if (!value) { return; }
	ABORT_IF(value->kind != JSON_ARRAY, "expected an array");
	JsonArray* array = &value->value._array;

	// Count entries.
	uint64_t len = json_array_len(array);

	// Allocate space for the paths.
	cx->manifest->preloads = ALLOC_N(cx->arena, len, String);
	cx->manifest->num_preloads = len;

	// Render each template.
	for(size_t n = 0; n < len; n++) {
		JsonValue* template = array->value;
		render_template(cx, template, &cx->manifest->preloads[n]);
		array = array->next;
	}
}

TG_VISIBILITY void parse_manifest_interpreter_args (Cx* cx, JsonValue* value) {
	if (!value) {
		return;
	}
	ABORT_IF(value->kind != JSON_ARRAY, "expected an array");
	JsonArray* array = &value->value._array;
	uint64_t len = json_array_len(array);
	cx->manifest->interp_argc = len;
	cx->manifest->interp_argv = ALLOC_N(cx->arena, len, String);
	for(int n = 0; n < len; n++) {
		JsonValue* itr = array->value;
		String* arg = cx->manifest->interp_argv + n;
		render_template(cx, itr, arg);
		array = array->next;
	}
}

TG_VISIBILITY void parse_manifest_executable (Cx* cx, JsonValue* value) {
	ABORT_IF(value->kind != JSON_OBJECT, "expected an object");
	JsonObject* object = &value->value._object;
	JsonValue* kind = json_get(object, "kind");
	ABORT_IF(!kind, "missing kind");
	ABORT_IF(kind->kind != JSON_STRING, "expected a string");

	if (cstreq(kind->value._string, "path")) {
		value = json_get(object, "value");
		render_template(cx, value, &cx->manifest->executable);
	} else if (cstreq(kind->value._string, "content")) {
		value = json_get(object, "value");
		render_content_executable(cx, value);
	} else if (cstreq(kind->value._string, "address")) {
		value = json_get(object, "value");
		ABORT_IF(value->kind != JSON_NUMBER, "expected a number");
		cx->manifest->entrypoint = (uint64_t)value->value._number;
	}
}

TG_VISIBILITY void parse_manifest_env (Cx* cx, JsonValue* value) {
	if (!value) {
		return;
	}
	ABORT_IF(value->kind != JSON_OBJECT, "expected an object");
	JsonObject* object = &value->value._object;
	JsonValue* kind = json_get(object, "kind");
	ABORT_IF(!kind, "missing kind");
	ABORT_IF(kind->kind != JSON_STRING, "expected a string");

	if (cstreq(kind->value._string, "unset")) {
		clear(&cx->manifest->env);
	} else if (cstreq(kind->value._string, "set")) {
		// Extract the inner object.
		value = json_get(object, "value");
		ABORT_IF(!value, "expected a value");
		ABORT_IF(value->kind != JSON_OBJECT, "expected an object");
		object = &value->value._object;

		// Get the inner kind.
		JsonValue* kind = json_get(object, "kind");
		ABORT_IF(!kind || kind->kind != JSON_STRING, "missing kind");
		ABORT_IF(!cstreq(kind->value._string, "map"), "expected a map");

		// Get the inner object.
		value = json_get(object, "value");
		ABORT_IF(value->kind != JSON_OBJECT, "expected an object");
		object = &value->value._object;
		apply_env(cx, &value->value._object);
	} else {
		ABORT("unsupported mutation type");
	}
}

TG_VISIBILITY void parse_manifest_args (Cx* cx, JsonValue* value) {
	if (!value) {
		return;
	}
	ABORT_IF(value->kind != JSON_ARRAY, "expected an array");
	JsonArray* array = &value->value._array;
	uint64_t len = json_array_len(array);
	cx->manifest->argc = (int)len;
	cx->manifest->argv = ALLOC_N(cx->arena, len, String);
	for(int n = 0; n < len; n++) {
		JsonValue* itr = array->value;
		String* arg = cx->manifest->argv + n;
		render_template(cx, itr, arg);
		array = array->next;
	}
}

TG_VISIBILITY bool is_mutation (JsonValue* value) {
	if (value->kind != JSON_OBJECT) {
		return false;
	}
	JsonObject* object = &value->value._object;
	JsonValue* kind = json_get(object, "kind");
	if (!kind) {
		return false;
	}
	if (kind->kind != JSON_STRING) {
		return false;
	}
	return cstreq(kind->value._string, "unset")
	|| cstreq(kind->value._string, "set")
	|| cstreq(kind->value._string, "set_if_unset")
	|| cstreq(kind->value._string, "prepend")
	|| cstreq(kind->value._string, "append")
	|| cstreq(kind->value._string, "prefix")
	|| cstreq(kind->value._string, "suffix")
	|| cstreq(kind->value._string, "merge");
}

TG_VISIBILITY bool is_template (JsonValue* value) {
	if (value->kind != JSON_OBJECT) {
		return false;
	}
	JsonObject* object = &value->value._object;
	return json_get(object, "components") != NULL;
}

TG_VISIBILITY void apply_env (Cx* cx, JsonObject* env) {
	while(env) {
		if (env->value) {
			String* key = &env->key;
			if (env->value->kind == JSON_ARRAY) {
				JsonArray* array = &env->value->value._array;
				while(array) {
					if (array->value) {
						ABORT_IF(array->value->kind != JSON_OBJECT, "expected an object");
						apply_mutation_to_key(cx, key, &array->value->value._object);
					}
					array = array->next;
				}
			} else {
				apply_value_to_key(cx, key, env->value);
			}
		}
		env = env->next;
	}
}

TG_VISIBILITY void apply_mutation_to_key (Cx* cx, String* key, JsonObject* mutation) {
	JsonValue* kind = json_get(mutation, "kind");
	ABORT_IF(!kind, "missing kind");
	ABORT_IF(kind->kind != JSON_STRING, "expected a string");
	if (cstreq(kind->value._string, "unset")) {
		remove(&cx->manifest->env, *key);
	} else if (cstreq(kind->value._string, "set")) {
		JsonValue* value = json_get(mutation, "value");
		apply_value_to_key(cx, key, value);
	} else if (cstreq(kind->value._string, "set_if_unset")) {
		if (!lookup(&cx->manifest->env, *key).ptr) {
			JsonValue* value = json_get(mutation, "value");
			apply_value_to_key(cx, key, value);
		}
	} else if (cstreq(kind->value._string, "append")) {
		JsonValue* values = json_get(mutation, "values");
		ABORT_IF(values->kind != JSON_ARRAY, "expected an array");
		JsonArray* array = &values->value._array;
		size_t len = json_array_len(array);
		String* ss = ALLOC_N(cx->arena, len + 1, String);
		size_t len_ = 0;
		ss[len_] = lookup(&cx->manifest->env, *key);
		if (ss[len_].ptr) {
			len_++;
		}
		JsonArray* curr = array;
		for (size_t n = 0; n < len; n++) {
			JsonValue* s = curr->value;
			ABORT_IF(s->kind != JSON_STRING, "expected a string");
			ss[len_++] = s->value._string;
			curr = curr->next;
		}
		String s = STRING_LITERAL(":");
		insert(cx->arena, &cx->manifest->env, *key, join(cx->arena, s, ss, len_));
	} else if (cstreq(kind->value._string, "prepend")) {
		JsonValue* values = json_get(mutation, "values");
		ABORT_IF(values->kind != JSON_ARRAY, "expected an array");
		JsonArray* array = &values->value._array;
		size_t len = json_array_len(array);
		String* ss = ALLOC_N(cx->arena, len + 1, String);

		JsonArray* curr = array;
		for (size_t n = 0; n < len; n++) {
			JsonValue* s = curr->value;
			ABORT_IF(s->kind != JSON_STRING, "expected a string");
			ss[n] = s->value._string;
			curr = curr->next;
		}

		ss[len] = lookup(&cx->manifest->env, *key);
		if (ss[len].ptr) {
			len++;
		}

		String s = STRING_LITERAL(":");
		insert(cx->arena, &cx->manifest->env, *key, join(cx->arena, s, ss, len));
	} else if (cstreq(kind->value._string, "prefix")) {
		// Lookup the existing value.
		String a = lookup(&cx->manifest->env, *key);

		// Destructure the value.
		JsonValue* template = json_get(mutation, "template");
		JsonValue* separator = json_get(mutation, "separator");

		// Destructure the object.
		ABORT_IF(!template, "expected a template");
		String b = {0};
		render_template(cx, template, &b);

		// Don't join if the value doesn't exist.
		if (!a.ptr) {
			insert(cx->arena, &cx->manifest->env, *key, b);
			return;
		}

		// Get the separator if it exists.
		String s = {0};
		if (separator) {
			ABORT_IF(separator->kind != JSON_STRING, "expected a string");
			s = separator->value._string;
		}

		// Update the env.
		String ss[2] = { b, a };
		insert(cx->arena, &cx->manifest->env, *key, join(cx->arena, s, ss, 2));
	} else if (cstreq(kind->value._string, "suffix")) {
		// Lookup the existing value.
		String a = lookup(&cx->manifest->env, *key);

		// Destructure the object.
		JsonValue* template = json_get(mutation, "template");
		JsonValue* separator = json_get(mutation, "separator");

		// Render the template.
		ABORT_IF(!template, "expected a template");
		String b = {0};
		render_template(cx, template, &b);

		// Don't join if the value doesn't exist.
		if (!a.ptr) {
			insert(cx->arena, &cx->manifest->env, *key, b);
			return;
		}

		// Get the separator if it exists.
		String s = {0};
		if (separator) {
			ABORT_IF(separator->kind != JSON_STRING, "expected a string");
			s = separator->value._string;
		}

		// Update the env.
		String ss[2] = { a, b };
		insert(cx->arena, &cx->manifest->env, *key, join(cx->arena, s, ss, 2));
	} else if (cstreq(kind->value._string, "merge")) {
		ABORT("merge mutations are not supported for environment variables");
	} else {
		ABORT(" unsupported mutation type (%s)", cstr(cx->arena, kind->value._string));
	}
}

TG_VISIBILITY void apply_value_to_key (Cx* cx, String* key, JsonValue* val) {
	// Handle mutations.
	if(val->kind == JSON_OBJECT) {
		JsonValue* kind = json_get(&val->value._object, "kind");
		if (kind && kind->kind == JSON_STRING && cstreq(kind->value._string, "mutation")) {
			val = json_get(&val->value._object, "value");
			ABORT_IF(!val || val->kind != JSON_OBJECT, "expected an object");
			apply_mutation_to_key(cx, key, &val->value._object);
			return;
		}
	}

	// Otherwise render the value and insert it.
	String rendered = render_value(cx, val);
	insert(cx->arena, &cx->manifest->env, *key, rendered);
}

TG_VISIBILITY void render_template (Cx* cx, JsonValue* template, String* rendered) {
	// Type check.
	ABORT_IF(template->kind != JSON_OBJECT, "expected an object")

	// Get the components.
	JsonValue* components = json_get(&template->value._object, "components");
	ABORT_IF(!components, "expected components");
	ABORT_IF(components->kind != JSON_ARRAY, "expected an array");

	// Render components.
	size_t capacity = 2048;
	rendered->ptr = (uint8_t*)alloc(cx->arena, capacity, 1);
	rendered->len = 0;

	JsonArray* array = &components->value._array;
	while (array) {
		if (array->value) {
			ABORT_IF(array->value->kind != JSON_OBJECT, "expected an object");
			JsonObject* object = &array->value->value._object;
			JsonValue* kind = json_get(object, "kind");
			JsonValue* value = json_get(object, "value");
			ABORT_IF(!kind, "missing kind");
			ABORT_IF(!value, "missing value");
			ABORT_IF(kind->kind != JSON_STRING, "expected a string");
			ABORT_IF(value->kind != JSON_STRING, "expected a string");
			if (cstreq(kind->value._string, "string")) {
				append_to_string(rendered, &value->value._string, capacity);
			} else if (cstreq(kind->value._string, "artifact")) {
				append_to_string(rendered, &cx->artifacts_dir, capacity);
				append_ch_to_string(rendered, '/', capacity);
				append_to_string(rendered, &value->value._string, capacity);
			} else {
				ABORT("unknown template component kind");
			}
		}
		array = array->next;
	}
}

TG_VISIBILITY void render_content_executable (Cx* cx, JsonValue* template) {
	if (cx->enable_tracing) {
		trace("rendering template to temp file");
	}

	// Create the path.
	String path = {
		.ptr = (uint8_t*)alloc(cx->arena, 2048, 1),
		.len = 0
	};

	// Get the TEMP directory.
	String temp = clookup(&cx->manifest->env, "TEMP");
	if (temp.ptr) {
		ABORT_IF(temp.len > 2000, "TEMP is too long");
		memcpy(path.ptr, temp.ptr, temp.len);
		path.len = temp.len;
	} else {
		memcpy(path.ptr, "/tmp", 4);
		path.len = 4;
	}

	// Append the template.
	memcpy(path.ptr + path.len, "/tmp.XXXXXX", 11);
	path.len += 10;
	tg_mktemp(&path);

	// Open the file.
	int fd = open((char*)path.ptr, O_RDWR | O_CREAT, 0664);
	ABORT_IF(fd < 0, "failed to open %s", path.ptr);

	// Render the template.
	render_template(cx, template, &cx->manifest->executable);

	// Write the rendered template to the file.
	String* rendered = &cx->manifest->executable;
	size_t len = 0;
	while(len < rendered->len) {
		long amt = write(fd, (void*)(rendered->ptr + len), rendered->len - len);
		ABORT_IF(amt < 0, "failed to write to temp file");
		if (amt == 0) {
			break;
		}
		len += amt;
	}

	ABORT_IF(lseek(fd, 0, SEEK_SET) < 0, "seek failed");

	// Remove the temp file.
	ABORT_IF(unlinkat(-1, (char*)path.ptr, 0), "failed to remove the temp");

	// Update the manifest.
	path.ptr = (uint8_t*)"/dev/fd";
	path.len = tg_strlen((char*)path.ptr);
	String file = {0};
	u64_to_string(cx->arena, (uint64_t)fd, &file);
	String ss[2] = {path, file};
	String sep = STRING_LITERAL("/");
	cx->manifest->executable = join(cx->arena, sep, ss, 2);
}

TG_VISIBILITY String render_value (Cx* cx, JsonValue* value) {
	String rendered = {0};
	switch(value->kind) {
		case JSON_NULL: return rendered;
		case JSON_BOOL: {
			rendered.ptr = value->value._bool ? (uint8_t*)"true" : (uint8_t*)"false";
			rendered.len = tg_strlen((char*)rendered.ptr);
			break;
		}
		case JSON_NUMBER: {
			double_to_string(cx->arena, value->value._number, &rendered);
			break;
		}
		case JSON_STRING: {
			rendered = value->value._string;
			break;
		}
		case JSON_OBJECT: {
			// Get the kind.
			JsonObject* object = &value->value._object;
			JsonValue* kind = json_get(object, "kind");
			ABORT_IF(!kind || kind->kind != JSON_STRING, "missing kind");

			// Get the value.
			value = json_get(object, "value");
			ABORT_IF(!value, "expected a value");

			// Check the type of the value.
			if (cstreq(kind->value._string, "map")) {
				ABORT("cannot render map in this context");
			} else if (cstreq(kind->value._string, "object")) {
				value = json_get(object, "value");
				ABORT_IF(!value || value->kind != JSON_STRING, "expected an ID");
				String ss[2] = { cx->artifacts_dir, value->value._string };
				String s = STRING_LITERAL("/");
				rendered = join(cx->arena, s, ss, 2);
				break;
			} else if (cstreq(kind->value._string, "bytes")) {
				ABORT("cannot render bytes in this context");
			} else if (cstreq(kind->value._string, "mutation")) {
				ABORT("cannot render mutation in this context");
			} else if (cstreq(kind->value._string, "template")) {
				render_template(cx, value, &rendered);
			} else {
				ABORT("unknown value type");
			}
			break;
		}
		default: ABORT("invalid manifest kind: %d", value->kind);
	}
	return rendered;
}
#undef ARTIFACTS_DIR
#undef ARTIFACTS_DIR_LEN
#undef OPT_ARTIFACTS_DIR
#undef OPT_ARTIFACTS_DIR_LEN
#undef PATH_MAX
#endif
