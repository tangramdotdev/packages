#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

extern void dependency(void);

int main(int argc, char** argv) {
	dependency();
	fflush(stdout);

	if (argc < 2) {
		fprintf(stderr, "usage: %s <inner-path>\n", argv[0]);
		return 1;
	}

	pid_t pid = fork();
	if (pid < 0) {
		fprintf(stderr, "fork: %s\n", strerror(errno));
		return 1;
	}
	if (pid == 0) {
		execl(argv[1], argv[1], (char*)NULL);
		fprintf(stderr, "execl %s: %s\n", argv[1], strerror(errno));
		_exit(127);
	}

	int status = 0;
	if (waitpid(pid, &status, 0) < 0) {
		fprintf(stderr, "waitpid: %s\n", strerror(errno));
		return 1;
	}
	return WIFEXITED(status) ? WEXITSTATUS(status) : 1;
}
