#include "json.h"
#include "manifest.h"

// Forward decls.
static void create_interpreter (Cx* cx, JsonValue* interpeter);
static void create_executable (Cx* cx, JsonValue* executable);
static void create_env (Cx* cx, JsonValue* env);
static void create_args (Cx* cx, JsonValue* args);
static void create_preloads (Cx* cx, JsonValue* value);
static void create_interp_args (Cx* cx, JsonValue* value);
static void create_loader_paths (Cx* cx, JsonValue* value); 
static void apply_env(Cx* cx, JsonObject* map);
static void apply_mutation_to_key (Cx* cx, String* key, JsonObject* mutation);
static void apply_value_to_key (Cx* cx, String* key, JsonValue* val);
static void render_template (Cx* cx, JsonValue* template, String* dst);
static void render_template_to_temp (Cx* cx, JsonValue* template);
static String render_value (Cx* cx, JsonValue* value);
static String render_object (Cx* cx, JsonValue* value);

void create_manifest_from_json (Cx* cx, JsonValue* value) {
	// Validate.
	ABORT_IF(value->kind != JSON_OBJECT, "expected an object (1)");

	// Parse fields.
	JsonObject* object = &value->value._object;
	while(object) {
		if (object->value) {
			if (cstreq(object->key, "interpreter")) {
				create_interpreter(cx, object->value);
			} else if (cstreq(object->key, "executable")) {
				create_executable(cx, object->value);
			} else if (cstreq(object->key, "env")) {
				create_env(cx, object->value);
			} else if (cstreq(object->key, "args")) {
				create_args(cx, object->value);
			}
		}
		object = object->next;
	}
}

static void create_interpreter (Cx* cx, JsonValue* value) {
	ABORT_IF(value->kind != JSON_OBJECT, "expected an object (2), got %d", value->kind);
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
		ABORT("dyld interpreter is unsupported in this context");
	} else {
		char* s = cstr(cx->arena, kind->value._string);
		ABORT("unknown interpreter kind %s", s);
	}
	JsonValue* path = json_get(object, "path");
	JsonValue* library_paths = json_get(object, "libraryPaths");
	JsonValue* preloads = json_get(object, "preloads");
	JsonValue* args = json_get(object, "args");
	ABORT_IF(!path, "expected an interpreter path");
	render_template(cx, path, &cx->manifest->interpreter);
	create_loader_paths(cx, library_paths);
	create_preloads(cx, preloads);
	create_interp_args(cx, args);
}

static void create_loader_paths (Cx* cx, JsonValue* value) {
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

static void create_preloads (Cx* cx, JsonValue* value) {
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

static void create_interp_args (Cx* cx, JsonValue* value) {
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

static void create_executable (Cx* cx, JsonValue* value) {
	ABORT_IF(value->kind != JSON_OBJECT, "expected an object (3)");
	JsonObject* object = &value->value._object;
	JsonValue* kind = json_get(object, "kind");
	ABORT_IF(!kind, "missing kind");
	ABORT_IF(kind->kind != JSON_STRING, "expected a string");
	
	if (cstreq(kind->value._string, "path")) {
		value = json_get(object, "value");
		render_template(cx, value, &cx->manifest->executable);
	} else if (cstreq(kind->value._string, "content")) {
		value = json_get(object, "value");
		render_template_to_temp(cx, value);
	} else if (cstreq(kind->value._string, "address")) {
		value = json_get(object, "value");
		ABORT_IF(value->kind != JSON_NUMBER, "expected a number");
		cx->manifest->entrypoint = (uint64_t)value->value._number;
	}
}

static void create_env (Cx* cx, JsonValue* value) {
	if (!value) {
		return;
	}
	ABORT_IF(value->kind != JSON_OBJECT, "expected an object (4)");
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
		ABORT_IF(value->kind != JSON_OBJECT, "expected an object (5)");
		object = &value->value._object;

		// Get the inner kind.
		JsonValue* kind = json_get(object, "kind");
		ABORT_IF(!kind || kind->kind != JSON_STRING, "missing kind (1)");
		ABORT_IF(!cstreq(kind->value._string, "map"), "expected a map (1)");

		// Get the inner object.
		value = json_get(object, "value");
		ABORT_IF(value->kind != JSON_OBJECT, "expected an object (6)");
		object = &value->value._object;
		apply_env(cx, &value->value._object);
	} else {
		ABORT("unsupported mutation type");
	}
}

static void create_args (Cx* cx, JsonValue* value) {
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

static bool is_mutation (JsonValue* value) {
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
	|| cstreq(kind->value._string, "set-if-unset")
	|| cstreq(kind->value._string, "prepend")
	|| cstreq(kind->value._string, "append")
	|| cstreq(kind->value._string, "prefix")
	|| cstreq(kind->value._string, "suffix")
	|| cstreq(kind->value._string, "merge");
}

static bool is_template (JsonValue* value) {
	if (value->kind != JSON_OBJECT) {
		return false;
	}
	JsonObject* object = &value->value._object;
	return json_get(object, "components") != NULL;
}

static void apply_env (Cx* cx, JsonObject* env) {
	while(env) {
		if (env->value) {
			String* key = &env->key;
			if (env->value->kind == JSON_ARRAY) {
				JsonArray* array = &env->value->value._array;
				while(array) {
					if (array->value) {
						ABORT_IF(array->value->kind != JSON_OBJECT, "expected an object (7)");
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

static void apply_mutation_to_key (Cx* cx, String* key, JsonObject* mutation) {
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
	} else if (cstreq(kind->value._string, "prepend")) {
		JsonValue* values = json_get(mutation, "values");
		ABORT_IF(values->kind != JSON_ARRAY, "expected an array");
		JsonArray* array = &values->value._array;
		size_t len = json_array_len(array);
		String* ss = ALLOC_N(cx->arena, len + 1, String);
		ss[0] = lookup(&cx->manifest->env, *key);
		for (size_t n = 0; n < len; n++) {
			JsonValue* s = array[n].value;
			ABORT_IF(s->kind != JSON_STRING, "expected a string");
			ss[n + 1] = s->value._string;
		}
		String s = STRING_LITERAL(":");
		insert(cx->arena, &cx->manifest->env, *key, join(cx->arena, s, ss, len + 1));
	} else if (cstreq(kind->value._string, "append")) {
		String existing = lookup(&cx->manifest->env, *key);
		JsonValue* values = json_get(mutation, "values");
		ABORT_IF(values->kind != JSON_ARRAY, "expected an array");
		JsonArray* array = &values->value._array;
		size_t len = json_array_len(array);
		String* ss = ALLOC_N(cx->arena, len + 1, String);
		
		for (size_t n = 0; n < len; n++) {
			JsonValue* s = array[n].value;
			ABORT_IF(s->kind != JSON_STRING, "expected a string");
			ss[n] = s->value._string;
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

static void apply_value_to_key (Cx* cx, String* key, JsonValue* val) {
	// Handle mutations.
	if(val->kind == JSON_OBJECT) {
		JsonValue* kind = json_get(&val->value._object, "kind");
		if (kind && kind->kind == JSON_STRING && cstreq(kind->value._string, "mutation")) {
			val = json_get(&val->value._object, "value");
			ABORT_IF(!val || val->kind != JSON_OBJECT, "expected an object (8)");
			apply_mutation_to_key(cx, key, &val->value._object);
			return;
		}
	}

	// Otherwise render the value and insert it.
	String rendered = render_value(cx, val);
	insert(cx->arena, &cx->manifest->env, *key, rendered);
}

static void render_template (Cx* cx, JsonValue* template, String* rendered) {
	// Type check.
	ABORT_IF(template->kind != JSON_OBJECT, "expected an object (9)")

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
			ABORT_IF(array->value->kind != JSON_OBJECT, "expected an object (10)");
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

void mktemp (String* string) {
	ABORT_IF(string->len <= 6, "string too small");
	size_t offset = string->len - 6;
	const char LOOKUP[256] = 
		"0123456789abcdefghijklmnopqrstuzwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ01"
		"23456789abcdefghijklmnopqrstuzwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123"
		"456789abcdefghijklmnopqrstuzwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ012345"
		"6789abcdefghijklmnopqrstuzwxyzABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh";
	ABORT_IF(getrandom((void*)&string->ptr[offset], 6, GRND_NONBLOCK) != 6, "getrandom() failed");
	for (; offset < string->len; offset++) {
		string->ptr[offset] = LOOKUP[(uint8_t)string->ptr[offset]];
	}
}

static void render_template_to_temp (Cx* cx, JsonValue* template) {
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
	mktemp(&path);

	// Open the file.
	int fd = open(path.ptr, O_RDWR | O_CREAT, 0664);
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
}

static String render_value (Cx* cx, JsonValue* value) {
	String rendered = {0};
	switch(value->kind) {
		case JSON_NULL: return rendered;
		case JSON_BOOL: {
			rendered.ptr = value->value._bool ? "true" : "false";
			rendered.len = strlen(rendered.ptr);
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
			ABORT_IF(!kind || kind->kind != JSON_STRING, "missing kind (2)");

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
		default: ABORT("malformed manifest (2) kind: %d", value->kind);
	}
	return rendered;
}
