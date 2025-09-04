#include <sys/syscall.h>
#include <stdio.h>

int main() {
	printf("__NR_write: %d\n", SYS_write);
	// printf("__NR_open: %d\n", SYS_open);
	printf("#define __NR_close =\t%d\n", SYS_close);
	// printf("#define __NR_stat =\t%d\n", SYS_stat);
	printf("#define __NR_lseek =\t%d\n", SYS_lseek);
	printf("#define __NR_mmap =\t%d\n", SYS_mmap);
	printf("#define __NR_munmap =\t%d\n", SYS_munmap);
	printf("#define __NR_pread64 =\t%d\n", SYS_pread64);
	printf("#define __NR_execve =\t%d\n", SYS_execve);
	printf("#define __NR_exit =\t%d\n", SYS_exit);
	printf("#define __NR_getcwd =\t%d\n", SYS_getcwd);
	// print#define f("__NR_readlink =\t%d\n", SYS_readlink);
	printf("#define __NR_getrlimit =\t%d\n", SYS_getrlimit);
	printf("#define __NR_getrandom =\t%d\n", SYS_getrandom);
	return 0;
}