/// This parser implements a subset of JSON. Notably, we assume numbers are integers.
#pragma once

// Standard includes.
#include <stdbool.h>
#include <stdint.h>

// Internals.
#include "arena.h"
#include "util.h"

// JSON value types
enum {
	JSON_NULL,
	JSON_BOOL,
	JSON_NUMBER,
	JSON_STRING,
	JSON_ARRAY,
	JSON_OBJECT
};

// Parsing errors
enum {
	ERROR_OK,
	ERROR_INVALID_CHAR,
	ERROR_UNEXPECTED_EOF
};

// Some forward declarations of types because C.
typedef struct JsonValue JsonValue;
typedef struct JsonArray JsonArray;
typedef struct JsonObject JsonObject;

// Arrays are implemented as linked lists. Ugh gross, I know, linked lists suck! But they're the
// right call here, since we don't know how many items are going to be in the array before we parse
// it, and we don't have an efficient implementation of realloc() available in our `Arena`
// allocator.
//
// If `value` and `next` are NULL the array is empty.
struct JsonArray {
	JsonValue*	value;
	JsonArray*	next;
};

// Like above, we use a linked list. Items may appear multiple times in the list (behavior is
// unspecified within JSON).
//
// If `value` and `next` are NULL the object is empty.
struct JsonObject {
	String		key;
	JsonValue*	value;
	JsonObject*	next;
};

// Values are a tagged enum.
struct JsonValue {
	uint8_t kind;
	union {
		bool		_bool;
		double		_number;
		String		_string;
		JsonArray	_array;
		JsonObject	_object;
	} value;
};

// Parser state
typedef struct {
	Arena*	arena;
	String	input;
	int	status;
} JsonParser;

// Forward declare the parsing functions.
static int parse_json_value (JsonParser* parser, JsonValue* value);
static int parse_json_object (JsonParser* parser, JsonObject* object);
static int parse_json_array (JsonParser* parser, JsonArray* value);
static int parse_json_string (JsonParser* parser, String* value);
static int parse_json_number (JsonParser* parser, double* value);
static int parse_json_keyword (JsonParser* parser, JsonValue* value);

// Ugly macros for implementing parsing rules.
#define ENSURE_NOT_EMPTY			\
	if (parser->input.len == 0) {		\
		return ERROR_UNEXPECTED_EOF;	\
	}

#define EAT_CHAR 		\
	parser->input.ptr++;	\
	parser->input.len--;

#define EAT_WHITESPACE				\
	while(parser->input.len) {		\
		uint8_t tok = *parser->input.ptr; \
		if (tok == ' ' || tok == '\n' || tok == '\t' || tok == '\f') { \
			EAT_CHAR; \
			continue; \
		} \
		break; \
	}

// Parse a single JSON value.
static int parse_json_value (JsonParser* parser, JsonValue* value) {
	// Consume whitespcae.
	EAT_WHITESPACE;
	ENSURE_NOT_EMPTY;

	// Peek the next token.
	switch (*parser->input.ptr) {
		case '{':
			value->kind = JSON_OBJECT;
			return parse_json_object(parser, &value->value._object);
		case '[':
			value->kind = JSON_ARRAY;
			return parse_json_array(parser, &value->value._array);
		case '"':
			value->kind = JSON_STRING;
			return parse_json_string(parser, &value->value._string);
		// 0 is a special case
		case '-':
		case '0': case '1': case '2': case '3': case '4': 
		case '5': case '6': case '7': case '8': case '9':
			value->kind = JSON_NUMBER;
			return parse_json_number(parser, &value->value._number);
		case 'n':
		case 't':
		case 'f':
			return parse_json_keyword(parser, value);
		// Anything else is invalid JSON!
		default:
			return ERROR_INVALID_CHAR;
	}
}

static int parse_json_object (JsonParser* parser, JsonObject* object) {
	// Eat the leading '{'.
	EAT_CHAR;

	// Clear the value object.
	memset((void*)object, 0, sizeof(JsonObject));

	// Parse fields.
	while (parser->input.len) {
		EAT_WHITESPACE;
		ENSURE_NOT_EMPTY;
		uint8_t tok = *parser->input.ptr;
		if (tok == '}') {
			break;
		}
		if (tok == '"') {
			// Parse the key.
			int ec = parse_json_string(parser, &object->key);
			if (ec) {
				return ec;
			}

			// Parse the ':' separator
			EAT_WHITESPACE;
			ENSURE_NOT_EMPTY;
			if (*parser->input.ptr != ':') {
				return ERROR_INVALID_CHAR;
			}
			EAT_CHAR;

			// Parse the value.
			object->value = ALLOC(parser->arena, JsonValue);
			ec = parse_json_value(parser, object->value);
			if (ec) {
				return ec;
			}

			// Parse the ',' if it exists.
			EAT_WHITESPACE;
			ENSURE_NOT_EMPTY;
			if (*parser->input.ptr == ',') {
				EAT_CHAR;

				// Allocate the next object in the list.
				object->next = ALLOC(parser->arena, JsonObject);

				// Follow the link.
				object = object->next;
				continue;
			}
		}
		break;
	}
	EAT_WHITESPACE;
	ENSURE_NOT_EMPTY;
	if (*parser->input.ptr != '}') {
		return ERROR_INVALID_CHAR;
	}
	EAT_CHAR;
	return ERROR_OK;
}

static int parse_json_array (JsonParser* parser, JsonArray* array) {
	// Eat the leading '['.
	EAT_CHAR;

	// Clear the value object.
	memset((void*)array, 0, sizeof(JsonArray));

	while(parser->input.len) {
		EAT_WHITESPACE;
		ENSURE_NOT_EMPTY;
		if (*parser->input.ptr == ']') {
			break;
		}

		// Parse the value.
		array->value = ALLOC(parser->arena, JsonValue);
		int ec = parse_json_value(parser, array->value);
		if (ec) {
			return ec;
		}

		// Parse the ',' if it exists.
		EAT_WHITESPACE;
		ENSURE_NOT_EMPTY;
		if (*parser->input.ptr == ',') {
			EAT_CHAR;

			// Allocate the next object in the list.
			array->next = ALLOC(parser->arena, JsonArray);

			// Follow the link.
			array = array->next;
			continue;
		}
	}

	EAT_WHITESPACE;
	ENSURE_NOT_EMPTY;
	if (*parser->input.ptr != ']') {
		return ERROR_INVALID_CHAR;
	}
	EAT_CHAR;
	return ERROR_OK;
}

static int parse_json_string (JsonParser* parser, String* string) {
	// Consume the opening '"'
	EAT_CHAR;

	// To start we assume the string can be a substring of the argument.
	string->ptr = parser->input.ptr;
	string->len = 0;

	// That assumption breaks if the string contains escape chars.
	bool has_escape_chars = false;
	while(parser->input.len) {
		// Peek one character to see if we're at the end.
		ENSURE_NOT_EMPTY;
		if (*parser->input.ptr == '"') {
			break;
		}

		// If the string contains '\' then we have to deal with escape characters.
		has_escape_chars |= (*parser->input.ptr == '\\');

		// Consume the token.
		EAT_CHAR;

		// Increment the length of the string.
		string->len++;
	}
	
	// Edge case: if the string contains a '\' then we need to allocate a string with the un-
	// escaped characters.
	if (has_escape_chars) {
		// The new string will always be smaller than the original, so we can use its old 
		// length as an upper bound.
		uint8_t* ptr = (uint8_t*)alloc(parser->arena, string->len, 1);
		uint32_t len = 0;
		
		// Hold onto the last token. The initial value doesn't matter but it can't be '\'.
		uint8_t prev_tok = ' ';
		
		// Create an iterator over the string chars.
		uint8_t* itr = string->ptr;
		uint8_t* end = itr + string->len;
		
		for(; itr != end; itr++) {
			uint8_t tok = *itr;

			// If the last char was '\' then we're currently escaping.
			if (prev_tok == '\\') {
				switch (tok) {
					case '"':
						ptr[len++] = '"';
						break;
					case '\\':
						ptr[len++] = '\\';
						break;
					case '/':
						ptr[len++] = '/';
						break;
					case 'b':
						ptr[len++] = '\b';
						break;
					case 'f':
						ptr[len++] = '\f';
						break;
					case 'n':
						ptr[len++] = '\n';
						break;
					case 'r':
						ptr[len++] = '\r';
						break;
					case 't':
						ptr[len++] = '\t';
						break;
					case 'u':
						ABORT("utf code points unsupported");
					default:
						return ERROR_INVALID_CHAR;
				}

				// Clear the state. The value doesn't matter, but it can't be '\'. 
				prev_tok = ' ';
				continue;
			}

			// If we're not escaping, append the token.
			if (tok != '\\') {
				ptr[len++] = tok;
			}

			// Update prev_tok.
			prev_tok = tok;
		}

		// Use the newly allocated string.
		string->ptr = ptr;
		string->len = len;
	}
	ENSURE_NOT_EMPTY;
	if (*parser->input.ptr != '"') {
		return ERROR_INVALID_CHAR;
	}
	EAT_CHAR;
	return ERROR_OK;
}

static bool is_digit (uint8_t tok) {
	return tok >= 48 && tok <= 57;
}

static int parse_json_number(JsonParser* parser, double* value) {
	// Note to future Mike from Sep. 8 2025: we'll never actually need doubles
	int sign = 1;
	uint64_t base  = 0;
	uint64_t pow10 = 1;

	// Parse the sign if it exists.
	if (*parser->input.ptr == '-') {
		EAT_CHAR;
		sign = -1;
	}

	// Parse the digits.
	while(parser->input.len) {
		uint8_t tok = *parser->input.ptr;
		if (tok >= 48 && tok <= 57) {
			EAT_CHAR;
			base *= 10;
			base += (tok - 48);
			if (base >= (1ul << 53ul)) {
				ABORT("overflow");
			}
		} else if (tok == '.' || tok == 'E' || tok == 'e') {
			ABORT("only integers supported");
		} else if (
			tok == ' ' 
			|| tok == '\n' 
			|| tok == '\r' 
			|| tok == '\t' 
			|| tok == ',' 
			|| tok == ']' 
			|| tok == '}'
		) {
			break;
		} else {
			return ERROR_INVALID_CHAR;
		}
	}

	// Compute the value.
	*value = (double)sign * (double)base;
	return ERROR_OK;
}

static int parse_json_keyword(JsonParser* parser, JsonValue* value) {
	String null_  = STRING_LITERAL("null");
	if (starts_with(parser->input, null_)) {
		value->kind = JSON_NULL;
		parser->input.ptr += null_.len;
		parser->input.len -= null_.len;
		return ERROR_OK;
	}
	String true_  = STRING_LITERAL("true");
	if (starts_with(parser->input, true_)) {
		value->kind = JSON_BOOL;
		value->value._bool = true;
		parser->input.ptr += true_.len;
		parser->input.len -= true_.len;
		return ERROR_OK;
	}
	String false_ = STRING_LITERAL("false");
	if (starts_with(parser->input, false_)) {
		value->kind = JSON_BOOL;
		value->value._bool = false;
		parser->input.ptr += false_.len;
		parser->input.len -= false_.len;
		return ERROR_OK;
	}
	return ERROR_INVALID_CHAR;
}
#undef ENSURE_NOT_EMPTY
#undef EAT_CHAR
#undef EAT_WHITESPACE

static int print_json_value(JsonValue* value);
static int print_json_object(JsonObject* object);
static int print_json_array(JsonArray* array);
static int print_json_string(String* string);

static int print_json_value(JsonValue* value) {
	switch (value->kind) {
		case JSON_NULL: 
			trace("null");
			break;
		case JSON_BOOL:
			value->value._bool ? trace("true")  : trace("false");
			break;
		case JSON_NUMBER:
			trace("%ld", (uint64_t)value->value._number);
			break;
		case JSON_STRING:
			print_json_string(&value->value._string);
			break;
		case JSON_ARRAY:
			print_json_array(&value->value._array);
			break;
		case JSON_OBJECT:
			print_json_object(&value->value._object);
			break;
		default:
			break;
	}
}

static int print_json_object(JsonObject* object) {
	trace("{");
	while (object) {
		if (object->value) {
			print_json_string(&object->key);
			trace(":");
			print_json_value(object->value);
		}
		object = object->next;
		if (object) {
			trace(",");
		}
	}
	trace("}");
}

static int print_json_array(JsonArray* array) {
	trace("[");
	while(array) {
		if (array->value) {
			print_json_value(array->value);
		}
		array = array->next;
		if (array) {
			trace(",");
		}
	}
	trace("]");
}

static int print_json_string (String* string) {
	trace("\"");
	uint8_t* itr = string->ptr;
	uint8_t* end = itr + string->len;
	for(; itr != end; itr++) {
		switch (*itr) {
			case '\n':
				trace("\\n");
				break;
			case '\t':
				trace("\\t");
				break;
			case '\f':
				trace("\\f");
				break;
			case '\\':
				trace("\\\\");
				break;
			case '\r':
				trace("\\r");
				break;
			default: 
				trace("%c", (char)*itr);
				break;
		}
	}
	trace("\"");
}

static JsonValue* json_get (JsonObject* object, const char* k) {
	while (object) {
		if (object->value && cstreq(object->key, k)) {
			return object->value;
		}
		object = object->next;
	}
	return NULL;
}

static uint64_t json_array_len (JsonArray* array) {
	uint64_t len = 0;
	while(array) {
		if (!array->value) {
			break;
		}
		array = array->next;
		len++;
	}
	return len;
}
