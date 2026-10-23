#include <dlfcn.h>
#include <stdio.h>

int main(int argc, char **argv) {
	const char *error = "no LLVM library was provided";
	for (int i = 1; i < argc; i++) {
		void *library = dlopen(argv[i], RTLD_NOW | RTLD_LOCAL);
		if (!library) {
			error = dlerror();
			continue;
		}
		void *(*create)(void) = (void *(*)(void))dlsym(library, "LLVMContextCreate");
		void (*dispose)(void *) = (void (*)(void *))dlsym(library, "LLVMContextDispose");
		if (!create || !dispose) {
			fprintf(stderr, "failed to find the LLVM context functions\n");
			return 1;
		}
		void *context = create();
		if (!context) {
			fprintf(stderr, "failed to create the LLVM context\n");
			return 1;
		}
		dispose(context);
		dlclose(library);
		puts("LLVM loaded");
		return 0;
	}
	fprintf(stderr, "failed to load LLVM: %s\n", error);
	return 1;
}
