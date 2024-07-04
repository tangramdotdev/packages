#ifdef __APPLE__
#include <mach-o/dyld.h>
#endif
#include <limits.h>
#include <unistd.h>
#include <stdio.h>
#include <stdlib.h>

extern char **environ;

int main(int argc, char *argv[]) {
		char path[PATH_MAX];

#ifdef __APPLE__
		uint32_t len = sizeof(path);
		if (_NSGetExecutablePath(path, &len) == -1) {
			perror("_NSGetExecutablePath");
			return EXIT_FAILURE;
		}
		printf("_NSGetExecutablePath: %s\n\n", path);
#else
		ssize_t len = readlink("/proc/self/exe", path, sizeof(path) - 1);
		if (len == -1) {
			perror("readlink");
			return EXIT_FAILURE;
		}
		path[len] = '\0';
		printf("/proc/self/exe: %s\n\n", path);
#endif


    printf("Command line arguments:\n");
    for (int i = 0; i < argc; i++) {
        printf("argv[%d]: %s\n", i, argv[i]);
    }

    printf("\nEnvironment variables:\n");
    for (char **env = environ; *env != NULL; env++) {
        printf("%s\n", *env);
    }

    return EXIT_SUCCESS;
}
