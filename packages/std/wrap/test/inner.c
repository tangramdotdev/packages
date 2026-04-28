#include <stdio.h>

extern void dependency(void);

int main(void) {
	dependency();
	fflush(stdout);
	return 0;
}
