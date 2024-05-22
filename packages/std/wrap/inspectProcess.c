#include <unistd.h>
#include <stdio.h>
#include <stdlib.h>

extern char **environ;

int main(int argc, char *argv[]) {
		char path[1024];
		ssize_t len = readlink("/proc/self/exe", path, sizeof(path) - 1);
		if (len == -1) {
			perror("readlink");
			return EXIT_FAILURE;
		}
		path[len] = '\0';
		printf("/proc/self/exe: %s\n\n", path);

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
