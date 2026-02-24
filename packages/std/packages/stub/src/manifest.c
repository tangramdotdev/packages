#include <stdint.h>
#include "arena.h"
#include "manifest.h"
#include "json.h"
#include "util.h"

#define ARTIFACTS_DIR "/.tangram/artifacts"
#define ARTIFACTS_DIR_LEN 19
#define OPT_ARTIFACTS_DIR "/opt/tangram/artifacts"
#define OPT_ARTIFACTS_DIR_LEN 22
#define PATH_MAX 4096

static void find_artifacts_dir (Arena* arena, String* path) {
	stat_t statbuf;

	// First check the root.
	if (stat(ARTIFACTS_DIR, &statbuf) == 0) {
		path->ptr = ARTIFACTS_DIR;
		path->len = ARTIFACTS_DIR_LEN;
		return;
	}

	// Check /opt/tangram/artifacts.
	if (stat(OPT_ARTIFACTS_DIR, &statbuf) == 0) {
		path->ptr = OPT_ARTIFACTS_DIR;
		path->len = OPT_ARTIFACTS_DIR_LEN;
		return;
	}

	// Get the parent directory of the current executable.
	path->ptr = alloc(arena, PATH_MAX, 1);
	long exe_len = readlink("/proc/self/exe", (char*)path->ptr, PATH_MAX - ARTIFACTS_DIR_LEN);
	ABORT_IF(exe_len <= 0, "failed to read /proc/self/exe");
	path->len = exe_len;
	*path = parent_dir(*path);

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
	manifest->raw.ptr = data;
	manifest->raw.len = len;
	String true_ = STRING_LITERAL("true");
	String clear_ld_library_path = STRING_LITERAL("TANGRAM_CLEAR_LD_LIBRARY_PATH");
	String clear_ld_preload = STRING_LITERAL("TANGRAM_CLEAR_LD_PRELOAD");
	String restore_ld_library_path = STRING_LITERAL("TANGRAM_RESTORE_LD_LIBRARY_PATH");
	String restore_ld_preload = STRING_LITERAL("TANGRAM_RESTORE_LD_PRELOAD");

	// Render paths.
	manifest-> ld_library_path = render_ld_library_path(arena, manifest);
	if (manifest->ld_library_path.ptr) {
		String key = STRING_LITERAL("LD_LIBRARY_PATH");
		String val = lookup(&manifest->env, key);
		if (val.ptr) {
			String ss[2] = { val, manifest->ld_library_path };
			String s = STRING_LITERAL(":");
			manifest->ld_library_path = join(arena, s, ss, 2);
			insert(arena, &manifest->env, restore_ld_library_path, val);
		} else {
			insert(arena, &manifest->env, clear_ld_library_path, true_);
		}
		insert(arena, &manifest->env, key, manifest->ld_library_path);
	}
	manifest->ld_preload = render_ld_preload(arena, manifest);
	if (manifest->ld_preload.ptr) {
		String key = STRING_LITERAL("LD_PRELOAD");
		String val = lookup(&manifest->env, key);
		if (val.ptr) {
			String ss[2] = { val, manifest->ld_preload };
			String s = STRING_LITERAL(":");
			manifest->ld_preload = join(arena, s, ss, 2);
			insert(arena, &manifest->env, restore_ld_preload, val);
		} else {
		}
		insert(arena, &manifest->env, clear_ld_preload, true_);
		insert(arena, &manifest->env, key, manifest->ld_preload);
	}
}
#undef PATH_MAX
