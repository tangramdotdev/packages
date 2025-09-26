#define _GNU_SOURCE
#include <stdlib.h>
#include <stdio.h>
__attribute__((constructor))
static void restore () {
	#ifdef DEBUG
		fprintf(stderr, "restoring environment\n");
	#endif
	char* e = NULL;
	e = getenv("TANGRAM_CLEAR_LD_LIBRARY_PATH");
	if (e) {
		unsetenv("TANGRAM_CLEAR_LD_LIBRARY_PATH");
		unsetenv("LD_LIBRARY_PATH");
	}
	e = getenv("TANGRAM_CLEAR_LD_PRELOAD");
	if (e) {
		unsetenv("TANGRAM_CLEAR_LD_PRELOAD");
		unsetenv("LD_PRELOAD");
	}
	e = getenv("TANGRAM_RESTORE_LD_LIBRARY_PATH");
	if (e) {
		unsetenv("TANGRAM_RESTORE_LD_LIBRARY_PATH");
		setenv("LD_LIBRARY_PATH", e, 1);
	}
	e = getenv("TANGRAM_RESTORE_LD_LIBRARY_PATH");
	if (e) {
		unsetenv("TANGRAM_RESTORE_LD_PRELOAD");
		setenv("LD_PRELOAD", e, 1);
	}
}
