// Simple deserializer for tangram_serialize encoded values.
// Note: strings and byte buffers contain pointers to the serialized data structure.
// TODO: remove *arena from deserializer state, add as discrete arg to be consistent.
#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "arena.h"
#include "util.h"

enum Error {
	OK,
	OVERFLOW,
	UNEXPECTED_EOF,
	UNKNOWN_KIND,
	EXPECTED_UNIT,
	EXPECTED_BOOL,
	EXPECTED_UVARINT,
	EXPECTED_IVARINT,
	EXPECTED_F32,
	EXPECTED_F64,
	EXPECTED_STRING,
	EXPECTED_BYTES,
	EXPECTED_OPTION,
	EXPECTED_ARRAY,
	EXPECTED_MAP,
	EXPECTED_STRUCT,
	EXPECTED_ENUM
};

enum Kind {
	UNIT	= 0,
	BOOL	= 1,
	UVARINT	= 2,
	IVARINT	= 3,
	F32	= 4,
	F64	= 5,
	STRING	= 6,
	BYTES	= 7,
	OPTION	= 8,
	ARRAY	= 9,
	MAP	= 10,
	STRUCT	= 11,
	ENUM	= 12
};

typedef struct Value Value;

typedef bool Bool;
typedef uint64_t UVarint;
typedef int64_t IVarint;
typedef float f32;
typedef double f64;

typedef struct {
	uint8_t* data;
	uint64_t len;
} Bytes;

typedef Value* Option;

typedef struct {
	Value* data;
	uint64_t len;
} Array;

typedef struct {
	Value* keys;
	Value* vals;
	uint64_t len;
} Map;

typedef struct {
	Value* value;
	uint8_t id;
} Field;

typedef struct {
	Field* fields;
	uint64_t len;
} Struct;

typedef struct {
	Value* value;
	uint8_t id;
} Enum;

struct Value {
	union 
	{
		Bool	_bool;
		UVarint	_uvarint;
		IVarint	_ivarint;
		f32	_f32;
		f64	_f64;
		String	_string;
		Bytes	_bytes;
		Option	_option;
		Array	_array;
		Map	_map;
		Struct	_struct;
		Enum	_enum;
	} value;
	uint8_t kind;
};

typedef struct {
	Arena*		arena;
	uint8_t*	data;
	uint64_t	len;
	uint64_t	cursor; 
} Deserializer;

static const char* deserializer_error (int ret) {
	switch(ret) {
		case OK: 		return "ok";
		case OVERFLOW: 		return "overflow";
		case UNEXPECTED_EOF: 	return "unexpected eof";
		case UNKNOWN_KIND: 	return "unknown kind";
		case EXPECTED_UNIT: 	return "expected unit";
		case EXPECTED_BOOL: 	return "expected_bool";
		case EXPECTED_UVARINT: 	return "expected uvarint";
		case EXPECTED_IVARINT: 	return "expected ivarint";
		case EXPECTED_F32: 	return "expected f32";
		case EXPECTED_F64: 	return "expected f64";
		case EXPECTED_STRING: 	return "expected string";
		case EXPECTED_BYTES: 	return "expected bytes";
		case EXPECTED_OPTION: 	return "expected option";
		case EXPECTED_ARRAY: 	return "expected array";
		case EXPECTED_MAP: 	return "expected map";
		case EXPECTED_STRUCT: 	return "expected_ truct";
		case EXPECTED_ENUM: 	return "expected enum";
		default: 		return "unknown error";
	}
}

static int deserialize_value (Deserializer* de, Value* value);

static inline int deserialize_kind (Deserializer* de, uint8_t* kind) {
	if (de->cursor == de->len) { return UNEXPECTED_EOF; }
	*kind = de->data[de->cursor++];
	return OK;
}

static inline int deserialize_bool (Deserializer* de, Bool* value) {
	if (de->cursor == de->len) { return UNEXPECTED_EOF; }
	switch (de->data[de->cursor]) {
		case 0: {
			*value = false;
			return OK;
		};
		case 1: {
			*value = true;
			return OK;
		};
		default: return EXPECTED_BOOL;
	}
}

static inline int deserialize_uvarint (Deserializer* de, UVarint* value) {
	uint64_t buf = 0;
	uint64_t shift = 0;
	for (int n = 0; n < 10; n++) {
		if (de->cursor == de->len) { return UNEXPECTED_EOF; }
		uint8_t byte = de->data[de->cursor++];
		buf |= (uint64_t)(0x7f & byte) << shift;
		if ((byte & 0x80) == 0) {
			*value = buf;
			return OK;
		}
	}
	return EXPECTED_UVARINT;
}

static inline int deserialize_ivarint (Deserializer* de, IVarint* value) {
	UVarint u;
	int ret = deserialize_uvarint(de, &u);
	if (ret) { return EXPECTED_IVARINT; };
	*value = (int64_t)(u >> 1) ^ -((int64_t)(u & 1));
	return OK;
}

static inline int deserialize_f32 (Deserializer* de, f32* value) {
	if (de->cursor + sizeof(f32) > de->len) { return UNEXPECTED_EOF; };
	memcpy((void*)value, (void*)(de->data + de->cursor), sizeof(f32));
	de->cursor += sizeof(f32);
	// todo: swizzle if be
	return OK;
}

static inline int deserialize_f64 (Deserializer* de, f64* value) {
	if (de->cursor + sizeof(f64) > de->len) { return UNEXPECTED_EOF; };
	memcpy((void*)value, (void*)(de->data + de->cursor), sizeof(f64));
	de->cursor += sizeof(f64);
	// todo: swizzle if be
	return OK;
}

static inline int deserialize_string (Deserializer* de, String* value) {
	int ret = deserialize_uvarint(de, &value->len);
	if (ret) { return ret; }
	value->ptr = de->data + de->cursor;
	de->cursor += value->len;
	return OK;
}

static inline int deserialize_bytes (Deserializer* de, Bytes* value) {
	int ret = deserialize_uvarint(de, &value->len);
	if (ret) { return ret; }
	value->data = de->data + de->cursor;
	de->cursor += value->len;
	return OK;
}

static inline int deserialize_option (Deserializer* de, Option* value) {
	// Deserialize and match on the tag.
	if (de->cursor == de->len) { return UNEXPECTED_EOF; }
	switch (de->data[de->cursor++]) {
		case 0: { 
			*value = NULL;
			return OK;
		}
		case 1: {
			*value = (Value*)alloc(de->arena, sizeof(Value), _Alignof(Value));
			if (!*value) { return OVERFLOW; }
			return deserialize_value(de, *value);
		}
		default: return EXPECTED_OPTION;
	}
}

static inline int deserialize_array (Deserializer* de, Array* value) {
	// Deserialize length.
	int ret = deserialize_uvarint(de, &value->len);
	if (ret) { return ret; }
	
	// Allocate space for the array itself.
	value->data = (Value*)alloc(de->arena, value->len * sizeof(Value), _Alignof(Value));
	memset(value->data, 0, sizeof(Value) * value->len);
	if (!value->data) { return OVERFLOW; }

	// Recurse.
	Value* itr = value->data;
	Value* end = itr + value->len;
	for(; itr != end; itr++) {
		ret = deserialize_value(de, itr);
		if (ret) { return ret; }
	}
	return OK;
}

static inline int deserialize_map (Deserializer* de, Map* value) {
	// Deserialize length.
	int ret = deserialize_uvarint(de, &value->len);
	if (ret) { return ret; }

	// Allocate space for entries.
	value->keys = (Value*)alloc(de->arena, 2 * value->len * sizeof(Value), _Alignof(Value));
	if(!value->keys) { return OVERFLOW; }
	value->vals = value->keys + value->len;

	// Deserialize entries.
	ret = OK;
	for (int n = 0; n < value->len; n++) {
		ret = deserialize_value(de, value->keys + n);
		if (ret) { return ret; }
		ret = deserialize_value(de, value->vals + n);
		if (ret) { return ret; }
	}

	return OK;
}

static inline int deserialize_struct (Deserializer* de, Struct* value) {
	// Deserialize length.
	int ret = deserialize_uvarint(de, &value->len);
	if (ret) { return ret; }

	// Allocate space for fields.
	value->fields = (Field*)alloc(de->arena, sizeof(Field) * value->len, _Alignof(Field));
	if (!value->fields) { return OVERFLOW; }

	// Deserialize fields.
	Field* itr = value->fields;
	Field* end = itr + value->len;
	ret = OK;
	for(; itr != end; itr++) {
		// Deserialize the ID.
		if (de->cursor == de->len) { return UNEXPECTED_EOF; }
		itr->id = de->data[de->cursor++];

		// Allocate space for the value.
		itr->value = (Value*)alloc(de->arena, sizeof(Value), _Alignof(Value));
		if (!itr->value) { return OVERFLOW; }

		// Deserialize the value.
		ret = deserialize_value(de, itr->value);
		if (ret) { return ret; }
	}

	return OK;
}

static inline int deserialize_enum (Deserializer* de, Enum* value) {
	// Deserialize the ID.
	if (de->cursor == de->len) { return UNEXPECTED_EOF; }
	value->id = de->data[de->cursor++];

	// Allocate space for the value.
	Value* v = (Value*)alloc(de->arena, sizeof(Value), _Alignof(Value));
	if (!v) { return OVERFLOW; }

	// Deserialize the value.
	int ret = deserialize_value(de, v);
	if (ret) { return ret; }

	value->value = v;
	return OK;
}

static int deserialize_value (Deserializer* de, Value* value) {
	// Deserialize the kind.
	int ret = deserialize_kind(de, &value->kind);
	if(ret) {
		return ret;
	}

	// Deserialize the data.
	switch(value->kind) {
		case UNIT:	return OK;
		case BOOL:	return deserialize_bool(de, &value->value._bool);
		case UVARINT:	return deserialize_uvarint(de, &value->value._uvarint);
		case IVARINT:	return deserialize_ivarint(de, &value->value._ivarint);
		case F32:	return deserialize_f32(de, &value->value._f32);
		case F64:	return deserialize_f64(de, &value->value._f64);
		case STRING:	return deserialize_string(de, &value->value._string);
		case BYTES:	return deserialize_bytes(de, &value->value._bytes);
		case OPTION:	return deserialize_option(de, &value->value._option);
		case ARRAY:	return deserialize_array(de, &value->value._array);
		case MAP:	return deserialize_map(de, &value->value._map);
		case STRUCT:	return deserialize_struct(de, &value->value._struct);
		case ENUM:	return deserialize_enum(de, &value->value._enum);
		default:	return UNKNOWN_KIND;
	}
}
