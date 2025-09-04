#define _GNU_SOURCE
#include <stdlib.h>
#include <stdio.h>
#include <stdbool.h>
#include <string.h>
#include <errno.h>
#define TRACE(...) if (tracing_enabled) { fprintf(stderr, "injection: "); fprintf(stderr, __VA_ARGS__); fprintf(stderr, "\n"); }

static bool CALLED = false;
extern char** environ;

static void unsetenv_internal (bool tracing_enabled, const char* name) {
	TRACE("clearing %s", name);
	char** itr = environ;
	for (; *itr; itr++) {
		char* e = *itr;
		size_t len = strlen(e);
		int starts_with = strncmp(e, name, len) == 0;
		if (starts_with && e[len] == '=') {
			e[len+1] = 0; // set this to the empty string.
		}
	}
	if (unsetenv(name)) {
		TRACE("warning: could not unset %s errno %d", name, errno);
	}
	if (getenv(name)) {
		TRACE("warning: could not unset %s, value still set", name);
	}
}

__attribute__((constructor))
static void restore () {
	if (CALLED) {
		return;
	}
	CALLED = true;
	bool tracing_enabled = getenv("TANGRAM_TRACING") != NULL;
	TRACE("restoring environment");

	const char* k= NULL;
	const char* v = NULL;

	k = "TANGRAM_CLEAR_LD_LIBRARY_PATH";
	v = getenv(k);
	if (v) {
		unsetenv_internal(tracing_enabled, "LD_LIBRARY_PATH");
	}
	unsetenv_internal(tracing_enabled, k);

	k = "TANGRAM_CLEAR_LD_PRELOAD";
	v = getenv(k);
	if (v) {
		unsetenv_internal(tracing_enabled, "LD_PRELOAD");
	}
	unsetenv_internal(tracing_enabled, k);

	k = "TANGRAM_RESTORE_LD_LIBRARY_PATH";
	v = getenv(k);
	if (v) {
		setenv(k, v, 1);
	}
	unsetenv_internal(tracing_enabled, k);

	k = "TANGRAM_RESTORE_LD_PRELOAD";
	v = getenv(k);
	if (v) {
		setenv(k, v, 1);
	}
	unsetenv_internal(tracing_enabled, k);
}
