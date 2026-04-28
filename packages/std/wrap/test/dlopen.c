#include <dlfcn.h>
#include <stdio.h>
int main() {
	char* error;
	void* lib = dlopen("./call_hello", RTLD_LAZY);
	if (!lib) {
		error = dlerror();
		fprintf(stderr, "failed to open libcall_hello: %s\n", error);
		return 1;
	}
	void (*call_hello)() = (void (*)())dlsym(lib, "call_hello");
	if (!call_hello) {
		error = dlerror();
		fprintf(stderr, "failed to bind lib_hello: %s\n", error);
		return 1;
	}
	call_hello();
	return 0;
}
