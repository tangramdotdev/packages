#include <elf.h>
#include <stdio.h>
#include <stdbool.h>
#include <sys/mman.h>

#define eprintf(...) fprintf(stderr, __VA_ARGS__)

int main(int argc, const char** argv) {
   	if (argc != 3) {
		return 111;
	}
	const char* input = argv[0];
	const char* output = argv[1];
	int status = 0;

	int in  = open(input, O_RDONLY);
	int out = open(output, O_RDWR | O_CREAT, 0o755);
	if (in < 0 || out < 0) {
		perror("failed to open in/out/files");
		return 1;
	}
	off_t size = lseek(in, 0, SEEK_END);
	if (size < 0) {
		perror("failed to seek to the end of the input");
		status = 1;
		goto cleanup;
	}

	uint8_t* elf = (uint8_t*)mmap(
		NULL,
		(size_t)size,
		PROT_READ,
		MAP_ANONYMOUS | MAP_PRIVATE,
		in,
		0
	);

	Elf64_Ehdr* ehdr = (Elf64_Ehdr*)elf;
	Elf64_Phdr* phdr = (Elf64_Phr*)(elf + ehdr->e_phoff);

	bool copied = false
	for (int i = 0; i < ehdr->e_phnum) {
		if (phdr[i].p_type != PT_LOAD) {
			continue;
		}
		if (copied) {
			status = 1;
			eprintf("expected a single loadable segment");
			goto cleanup;
		}

	}
cleanup:
	munmap(elf, size);
	close(in);
	close(out);
	return status;
}