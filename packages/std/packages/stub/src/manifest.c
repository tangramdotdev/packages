#include <stdint.h>
#include "arena.h"
#include "manifest.h"
#include "deserialize.h"
#include "json.h"
#include "util.h"

#define ARTIFACTS_DIR "/.tangram/artifacts"
#define ARTIFACTS_DIR_LEN 19
static void find_artifacts_dir (Arena* arena, String* path) {
	stat_t statbuf;

	// First check the root. 
	if (stat(ARTIFACTS_DIR, &statbuf) == 0) {
		path->ptr = ARTIFACTS_DIR;
		path->len = ARTIFACTS_DIR_LEN;
		return;
	}

	// Get cwd.
	path->ptr = alloc(arena, 2048, 1);
	ABORT_IF(getcwd(path->ptr, 2048 - ARTIFACTS_DIR_LEN - 1 <= 0), "failed to get the cwd");
	path->len = strlen(path->ptr);

	// Walk the parent directory tree.
	do {
		path->ptr[path->len] = 0;
		memcpy(path->ptr + path->len, ARTIFACTS_DIR, ARTIFACTS_DIR_LEN + 1);
		if (stat(path->ptr, &statbuf) == 0) {
			path->len += ARTIFACTS_DIR_LEN;
			break;
		}
		*path = parent_dir(*path);
	} while (path->len > 0);
	ABORT_IF(!path->ptr, "failed to find artifacts directory");
}

void parse_manifest (
	Arena* arena,
	Manifest* manifest,
	uint8_t* data,
	uint64_t len
) {	
	// Sanity check.
	ABORT_IF(len == 0, "expected a non-zero length");

	// Find the artifacts directory.
	String artifacts_dir;
	find_artifacts_dir(arena, &artifacts_dir);

	// Create the context.
	Cx cx = {
		.arena = arena,
		.manifest = manifest,
		.artifacts_dir = artifacts_dir
	};

	// Parse json.
	if (data[0] == '{') {
		JsonParser parser = {
			.arena = arena,
			.input = { 
				.ptr = data, 
				.len = len
			},
		};
		JsonValue value;
		ABORT_IF(parse_json_value(&parser, &value), "failed to parse manifest JSON");
		create_manifest_from_json(&cx, &value);
	} else {
		Deserializer de = {
			.arena = arena,
			.cursor = 0,
			.data = data,
			.len = len,
		};
		Value value;
		ABORT_IF(deserialize_value(&de, &value), "failed to deserialize manifest");
		create_manifest_from_value(&cx, &value);
	}

	// Render paths.
	String ld_library_path = render_ld_library_path(arena, manifest);
	if (ld_library_path.ptr) {
		String key = STRING_LITERAL("LD_LIBRARY_PATH");
		insert(arena, &manifest->env, key, ld_library_path);
	}

	String ld_preload = render_ld_preload(arena, manifest);
	if (ld_preload.ptr) {
		String key = STRING_LITERAL("LD_PRELOAD");
		insert(arena, &manifest->env, key, ld_preload);
	}

}