#include <stdio.h>
extern char** environ;
int main(int argc, const char** argv) {
	for (int i = 0; i < 2; i++) {
		const char* var = i ? "envp" : "argv";
		const char** s = i ? (const char**)environ : argv;
		int j = 0;
		for (; *s; s++, j++) {
			printf("%s[%d] = %s\n", var, j, *s);
		}
	}
	return 0;
}	
