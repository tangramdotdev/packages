#include <assert.h>
#include <stdio.h>
#include "json.h"

int main () {
	String document = STRING_LITERAL(
		"{\n"
		"	\"null\": null,\n"
		"	\"true\": true,\n"
		"	\"false\": false,\n"
		"	\"number\": 1234567890,\n"
		"	\"string\": \"hello, world!\\n\",\n"
		"	\"array\": ["
		"		null,\n"
		"		true,\n"
		"		false,\n"
		"		1234567890,\n"
		"		\"hello, world!\\n\",\n"
		"		[],\n"
		"		{}\n"
		"	],\n"
		"	\"object\": {\n"
		"		\"null\": null,\n"
		"		\"true\": true,\n"
		"		\"false\": false,\n"
		"		\"number\": 1234567890,\n"
		"		\"string\": \"hello, world!\\n\",\n"
		"		\"array\": [],\n"
		"		\"object\": {}\n"
		"	}\n"
		"}"
	);
	Arena arena;
	create_arena(&arena);

	JsonValue value;
	JsonParser parser = {
		.arena = &arena,
		.input = document,
		.status = 0
	};
	int ec = parse_json_value(&parser, &value);
	assert(ec == ERROR_OK);
	assert(value.kind == JSON_OBJECT);
	print_json_value(&value);
	return 0;
}	
