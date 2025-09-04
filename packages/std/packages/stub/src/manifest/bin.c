#include "deserialize.h"
#include "manifest.h"
#include "util.h"

enum ManifestFields {
	INTERPRETER	= 0,
	EXECUTABLE	= 1,
	ENV		= 2,
	ARGS		= 3
};

enum InterpreterVariant {
	NORMAL,
	LD_LINUX,
	LD_MUSL,
	DYLD
};

// Forward decls.
static void create_interpreter (Cx* cx, Value* value);
static void create_executable (Cx* cx, Value* executable);
static void create_env (Cx* cx, Value* env);
static void create_args (Cx* cx, Value* args);
static void create_preloads (Cx* cx, Value* value) ;
static void create_loader_paths (Cx* cx, Value* value); 
static void apply_env(Cx* cx, Map* map);
static void apply_mutation_to_key (Cx* cx, String* key, Enum* mutation);
static void apply_value_to_key (Cx* cx, String* key, Enum* val);
static void render_template (Cx* cx, Value* template, String* dst);
static String render_value (Cx* cx, Enum* value);

void create_manifest_from_value (Cx* cx, Value* value) {
	// Validate.
	ABORT_IF(value->kind != STRUCT, "expected a struct");
	Struct struct_ = value->value._struct;

	// Parse fields.
	Field* itr = struct_.fields;
	Field* end = itr + struct_.len;
	for (; itr != end; itr++) {
		switch (itr->id) {
			case INTERPRETER: {
				create_interpreter(cx, itr->value);
				continue;
			}
			case EXECUTABLE: {
				create_executable(cx, itr->value);
				continue;
			}
			case ENV: {
				create_env(cx, itr->value);
				continue;
			}
			case ARGS: {
				create_args(cx, itr->value);
				continue;
			}
			default: continue;
		}
	}
}

static void create_interpreter (Cx* cx, Value* value) {
	ABORT_IF(value->kind != OPTION, "expected an option")	;
	value = value->value._option;
	if (!value) { 
		return;
	}
	ABORT_IF(value->kind != ENUM, "expected an enum");
	Enum enum_ = value->value._enum;
	switch(enum_.id) {
		case NORMAL: {
			ABORT("todo: normal interpeter");
		}
		case LD_LINUX:
		case LD_MUSL: {
			value = enum_.value;
			break;
		}
		case DYLD:
			ABORT("dyld interpreter is unsupported in this context");
		default:
			ABORT("unknown interpreter type: %d", enum_.id);
	}
	ABORT_IF(value->kind != STRUCT, "expected a struct");
	Field* itr = value->value._struct.fields;
	Field* end = itr + value->value._struct.len;
	for(; itr != end; itr++) {
		switch (itr->id) {
			case 0: {
				Value* template = itr->value;
				render_template(cx, template, &cx->manifest->interpreter);
				continue;
			}
			case 1: {
				ABORT_IF(itr->value->kind != OPTION, "expected an option");
				create_loader_paths(cx, itr->value->value._option);
				continue;
			}
			case 2: {
				ABORT_IF(itr->value->kind != OPTION, "expected an option");
				create_preloads(cx, itr->value->value._option);
			}
			default: continue;
		}
	}
}

static void create_loader_paths (Cx* cx, Value* value) {
	// Type check.
	if (!value) { return; }
	if (value->kind != ARRAY) ABORT("expected an array");
	uint64_t len = value->value._array.len;

	// Allocate space for the paths.
	cx->manifest->library_paths = ALLOC_N(cx->arena, len, String);	cx->manifest->num_library_paths = len;

	// Render each template.
	Value* template = value->value._array.data;
	for(size_t n = 0; n < len; n++) {
		render_template(cx, &template[n], &cx->manifest->library_paths[n]);
	}
}

static void create_preloads (Cx* cx, Value* value) {
	// Type check.
	if (!value) { return; }
	if (value->kind != ARRAY) ABORT("expected an array");
	uint64_t len = value->value._array.len;

	// Allocate space for the paths.
	cx->manifest->preloads = ALLOC_N(cx->arena, len, String);

	// Render each template.
	Value* template = value->value._array.data;
	for(size_t n = 0; n < len; n++) {
		render_template(cx, &template[n], &cx->manifest->preloads[n]);
	}
}

static void create_executable (
	Cx* cx,
	Value* value
) {
	ABORT_IF(value->kind != ENUM, "expected an executable");
	Enum executable = value->value._enum;
	switch (executable.id)  {
		case 0: {
			ABORT_IF(executable.value->kind != STRUCT, "expected a struct");
			ABORT("todo: path");
		}
		case 1: ABORT("todo: content");
		case 2: {
			ABORT_IF(executable.value->kind != UVARINT, "expected an integer");
			cx->manifest->entrypoint = executable.value->value._uvarint;		
			break;
		}
	}
}

static void create_env (Cx* cx, Value* value) {
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
			clear(&cx->manifest->env);
			break;
		}
		// SET
		case 1: {
			DBG("mutation: \n");
			ABORT_IF(mutation.value->kind != ENUM, "expected a value");
			Enum inner = mutation.value->value._enum;
			ABORT_IF(inner.id != 5 || inner.value->kind != MAP, "expected a map");
			Map* map = &inner.value->value._map;
			apply_env(cx, map);
			break;
		}
		// todo: merge
		// ignore anything else. TODO: error?
		default: {
			return;
		}
	}
}

static void create_args (Cx* cx, Value* value) {
	ABORT_IF(value->kind != OPTION, "expected an option");
	value = value->value._option;
	if (!value) {
		return;
	}
	ABORT_IF(value->kind != ARRAY, "expected an array");
	Array* array = &value->value._array;
	uint64_t len = array->len;
	cx->manifest->argc = (int)len;
	cx->manifest->argv = ALLOC_N(cx->arena, len, String);
	for(int n = 0; n < len; n++) {
		Value* itr = array->data + n;
		String* arg = cx->manifest->argv + n;
		render_template(cx, itr, arg);
	}
}

static void apply_env (Cx* cx, Map* env) {
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
					apply_mutation_to_key(cx, key, &itr->value._enum);
				}
				break;
			}
			// MUTATION
			case 8: {
				if (val->value->kind != ENUM) { ABORT("expected an enum"); }
				apply_mutation_to_key(cx, key, &val->value->value._enum);
				break;
			}
			// Everything else
			default: {
				if (val->value->kind != ENUM) { ABORT("expected an enum"); }
				apply_value_to_key(cx, key, &val->value->value._enum);
				break;
			}
		}
	}
}

static void apply_mutation_to_key (Cx* cx, String* key, Enum* mutation) {
	switch(mutation->id) {
		// UNSET
		case 0: {
			remove(&cx->manifest->env, *key);
			break;
		}
		// SET
		case 1: {
			if (mutation->value->kind != ENUM) { ABORT("expected an enum"); }
			apply_value_to_key(cx, key, &mutation->value->value._enum);
			break;
		}
		// SET IF UNSET
		case 2: {
			if (lookup(&cx->manifest->env, *key).ptr) {
				if (mutation->value->kind != ENUM) { ABORT("expected an enum"); }
				apply_value_to_key(cx, key, &mutation->value->value._enum);
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

static void apply_value_to_key (Cx* cx, String* key, Enum* val) {
	if (val->id == 4 || val->id == 8) {
		ABORT("todo: array/mutation handling");
	}
	String rendered = render_value(cx, val);
	insert(cx->arena, &cx->manifest->env, *key, rendered);
}

static void render_template (Cx* cx, Value* template, String* rendered) {
	// Type check.
	ABORT_IF(template->kind != STRUCT, "expected a struct")

	// Get the components.
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

	//  Validate.
	if (!components) {
		ABORT("expected components");
	}
	ABORT_IF(components->kind != ARRAY, "expected an array");

	// Render components.
	size_t capacity = 2048;
	rendered->ptr = (uint8_t*)alloc(cx->arena, capacity, 1);
	rendered->len = 0;

	Value* itr = components->value._array.data;
	Value* end = itr + components->value._array.len;
	for(; itr != end; itr++) {
		ABORT_IF(itr->kind != ENUM, "expected an enum");
		switch(itr->value._enum.id) {
			case 0: {
				ABORT_IF(itr->value._enum.value->kind != STRING, "expected a string");
				String* string = &itr->value._enum.value->value._string;
				append_to_string(rendered, string, capacity);
				continue;
			}
			case 1: {
				ABORT_IF(itr->value._enum.value->kind != BYTES, "expected a byte string");
				append_to_string(rendered, &cx->artifacts_dir, capacity);
				append_ch_to_string(rendered, '/', capacity);
				append_id_to_string(rendered, &itr->value._enum.value->value._bytes, capacity);
				continue;
			}
			default: continue;
		}
	}
}

static String render_value (Cx* cx, Enum* value) {
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
			render_template(cx, value->value, &rendered);
			break;
		}
		default: ABORT("malformed env manifest");
	}
	return rendered;
}
