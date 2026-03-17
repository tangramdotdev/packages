#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// Prints LD_LIBRARY_PATH, then optionally dlopens a module whose transitive
// dependency is only findable via LD_LIBRARY_PATH. This simulates python
// trying to import a C extension that depends on a library not in the
// wrapper's manifest library paths.

#include <dlfcn.h>

int main(int argc, char** argv) {
	const char* ldlp = getenv("LD_LIBRARY_PATH");
	if (ldlp) {
		fprintf(stderr, "LD_LIBRARY_PATH=%s\n", ldlp);
	} else {
		fprintf(stderr, "LD_LIBRARY_PATH is unset\n");
	}

	// If we got a module path as arg, try to dlopen it.
	if (argc > 1) {
		void* lib = dlopen(argv[1], RTLD_NOW);
		if (!lib) {
			fprintf(stderr, "dlopen failed: %s\n", dlerror());
			printf("FAIL\n");
			return 1;
		}
		void (*fn)() = (void (*)())dlsym(lib, "call_hello");
		if (fn) {
			fn();
		} else {
			printf("OK\n");
		}
		dlclose(lib);
	} else {
		// Just print LD_LIBRARY_PATH value to stdout for testing.
		printf("%s\n", ldlp ? ldlp : "UNSET");
	}
	return 0;
}
