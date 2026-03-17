#pragma once
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>

#define TRACE(...) \
	if (tracing_enabled) { 				\
		fprintf(stderr, "tangram injection: "); \
		fprintf(stderr, __VA_ARGS__); 		\
		fprintf(stderr, "\n"); 			\
	}


#define TANGRAM_LIBRARY_PATH		"TANGRAM_INJECTION_LIBRARY_PATH"
#define TANGRAM_PRELOAD 		"TANGRAM_INJECTION_PRELOAD"
#define TANGRAM_CLEAR_LIBRARY_PATH	"TANGRAM_INJECTION_CLEAR_LIBRARY_PATH"
#define TANGRAM_CLEAR_PRELOAD 		"TANGRAM_INJECTION_CLEAR_PRELOAD"

#ifdef __linux__
#define LD_LIBRARY_PATH		"LD_LIBRARY_PATH"
#define LD_PRELOAD		"LD_PRELOAD"
#endif

#ifdef __APPLE__
#define LD_LIBRARY_PATH		"DYLD_LIBRARY_PATH"
#define LD_PRELOAD		"DYLD_INSERT_LIBRARIES"
#endif

extern char** environ;
static void unsetenv_internal (bool tracing_enabled, const char* name) {
	TRACE("unsetenv %s", name);
#ifdef __linux__
	// Some loaders mixup environ** and getenv/setenv state.
	for (int i = 0; environ[i]; i++) {
		char* e = environ[i];
		size_t len = strlen(name);
		int starts_with = strncmp(e, name, len) == 0;
		if (starts_with && e[len] == '=') {
			for (int j = i; environ[j]; j++) {
				environ[j] = environ[j + 1];
			}
			break;
		}
	}
#endif
	if (unsetenv(name)) {
		TRACE("warning: could not unset %s errno %d", name, errno);
	}
	if (getenv(name)) {
		TRACE("warning: could not unset %s, value still set", name);
	}
}

static bool CALLED = false;
static void restore_environment() {
	if (CALLED) {
		return;
	}
	CALLED = true;
	bool tracing_enabled = getenv("TG_PRELOAD_TRACING") != NULL;
	TRACE("restoring environment");

	const char* k = NULL;
	const char* v = NULL;

	k = TANGRAM_LIBRARY_PATH;
	v = getenv(k);
	if (v) {
		setenv(LD_LIBRARY_PATH, v, 1);
	}
	unsetenv_internal(tracing_enabled, k);

	k = TANGRAM_PRELOAD;
	v = getenv(k);
	if (v) {
		setenv(LD_PRELOAD, v, 1);
	}

	k = TANGRAM_CLEAR_LIBRARY_PATH;
	v = getenv(k);
	if (v) {
		unsetenv_internal(tracing_enabled, LD_LIBRARY_PATH);
	}
	unsetenv_internal(tracing_enabled, k);

	k = TANGRAM_CLEAR_PRELOAD;
	v = getenv(k);
	if (v) {
		unsetenv_internal(tracing_enabled, LD_PRELOAD);
	}
	unsetenv_internal(tracing_enabled, k);
}
