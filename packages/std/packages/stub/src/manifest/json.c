#include "json.h"
#include "manifest.h"

// Forward decls.
static void create_interpreter (Cx* cx, JsonValue* interpeter);
static void create_executable (Cx* cx, JsonValue* executable);
static void create_env (Cx* cx, JsonValue* env);
static void create_args (Cx* cx, JsonValue* args);
static void create_preloads (Cx* cx, JsonValue* value) ;
static void create_loader_paths (Cx* cx, JsonValue* value); 
static void apply_env(Cx* cx, JsonObject* map);
static void apply_mutation_to_key (Cx* cx, String* key, JsonObject* mutation);
static void apply_value_to_key (Cx* cx, String* key, JsonValue* val);
static void render_template (Cx* cx, JsonValue* template, String* dst);
static String render_value (Cx* cx, JsonValue* value);

void create_manifest_from_json (Cx* cx, JsonValue* value) {
	// Validate.
	ABORT_IF(value->kind != JSON_OBJECT, "expected an object");

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
	ABORT_IF(value->kind != JSON_OBJECT, "expected an object");
	JsonObject* object = &value->value._object;
	JsonValue* kind = json_get(object, "kind");
	ABORT_IF(!kind, "expected a kind string");
	ABORT_IF(kind->kind != JSON_STRING, "expected a string");
	if (cstreq(kind->value._string, "normal")) {
		ABORT("todo: normal interpreter");
	} else if (
		cstreq(kind->value._string, "ld-musl")
		|| cstreq(kind->value._string, "ld-musl")
	) {
		// ok
	} else if (cstreq(kind->value._string, "dyld")) {
		ABORT("dyld interpreter is unsupported in this context");
	} else {
		ABORT("unknown interpreter kind");
	}
	JsonValue* path = json_get(object, "path");
	JsonValue* library_paths = json_get(object, "libraryPaths");
	JsonValue* preloads = json_get(object, "preloads");
	
	ABORT_IF(!path, "expected an interpreter path");
	render_template(cx, path, &cx->manifest->interpreter);
	create_loader_paths(cx, library_paths);
	create_preloads(cx, preloads);
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

static void create_executable (Cx* cx, JsonValue* value) {
	ABORT_IF(value->kind != JSON_OBJECT, "expected an object");
	JsonObject* object = &value->value._object;
	JsonValue* kind = json_get(object, "kind");
	ABORT_IF(!kind, "missing kind");
	ABORT_IF(kind->kind != JSON_STRING, "expected a string");
	
	if (cstreq(kind->value._string, "path")) {
		value = json_get(object, "value");
		render_template(cx, value, &cx->manifest->executable);
	} else if (cstreq(kind->value._string, "content")) {
		ABORT("todo: content");
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
	ABORT_IF(value->kind != JSON_OBJECT, "expected an object");
	JsonObject* object = &value->value._object;
	JsonValue* kind = json_get(object, "kind");
	ABORT_IF(!kind, "missing kind");
	ABORT_IF(kind->kind != JSON_STRING, "expected a string");

	if (cstreq(kind->value._string, "unset")) {
		clear(&cx->manifest->env);
	} else if (cstreq(kind->value._string, "set")) {
		value = json_get(object, "value");
		ABORT_IF(!value, "expected a value");
		ABORT_IF(value->kind != JSON_OBJECT, "expected an object");
		apply_env(cx, &value->value._object);
	} else if (cstreq(kind->value._string, "merge")) {
		ABORT("todo: merge envs");
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
			if (is_mutation(env->value)) {
				apply_mutation_to_key(cx, key, &env->value->value._object);
			} else if (env->value->kind == JSON_ARRAY) {
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

static void apply_mutation_to_key (Cx* cx, String* key, JsonObject* mutation) {
	JsonValue* kind = json_get(mutation, "kind");
	ABORT_IF(!kind, "missing kind");
	ABORT_IF(kind->kind != JSON_STRING, "expected a string");
	if (cstreq(kind->value._string, "unset")) {
		remove(&cx->manifest->env, *key);
	} else if (cstreq(kind->value._string, "set")) {
		JsonValue* value = json_get(mutation, "value");
		apply_value_to_key(cx, key, value);
	} else if (cstreq(kind->value._string, "set-if-unset")) {
		if (lookup(&cx->manifest->env, *key).ptr) {
			JsonValue* value = json_get(mutation, "value");
			apply_value_to_key(cx, key, value);
		}
	} else {
		ABORT("unsupported mutation type");
	}
}

static void apply_value_to_key (Cx* cx, String* key, JsonValue* val) {
	String rendered = render_value(cx, val);
	insert(cx->arena, &cx->manifest->env, *key, rendered);
}

static void render_template (Cx* cx, JsonValue* template, String* rendered) {
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

static String render_value (Cx* cx, JsonValue* value) {
	String rendered = {0};
	switch(value->kind) {
		// Null
		case JSON_NULL: return rendered;

		// Bool
		case JSON_BOOL: {
			rendered.ptr = value->value._bool ? "true" : "false";
			rendered.len = strlen(rendered.ptr);
			break;
		}

		// Number
		case JSON_NUMBER: ABORT("todo: numbers");

		// String
		case JSON_STRING: {
			rendered.ptr = value->value._string.ptr;
			rendered.len = value->value._string.len;
			break;
		}

		// Template.
		case JSON_OBJECT: {
			if (is_template(value)) {
				render_template(cx, value, &rendered);
			}
			break;
		}

		default: ABORT("malformed env manifest");
	}
	return rendered;
}
