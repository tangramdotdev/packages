#include <stdio.h>
#include <dlfcn.h>

int main(void) {
		void *handle;
		void (*greet)(void);
		char *error;

		// Define the shared library name based on the platform
		#ifdef __APPLE__
				const char *library_name = "libgreet.dylib";
		#else
				const char *library_name = "libgreet.so";
		#endif

		// Open the shared library
		handle = dlopen(library_name, RTLD_LAZY);
		if (!handle) {
				fprintf(stderr, "%s\n", dlerror());
				return 1;
		}

		// Clear any existing errors
		dlerror();

		// Load the symbol
		*(void **) (&greet) = dlsym(handle, "greet");

		// Check for errors
		error = dlerror();
		if (error != NULL) {
				fprintf(stderr, "%s\n", error);
				dlclose(handle);
				return 1;
		}

		// Call the function
		greet();

		// Close the handle
		dlclose(handle);

		return 0;
}
