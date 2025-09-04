// Executable that binds an existing binary to an 

// Common includes.
#define _GNU_SOURCE
#include <elf.h>
#include <fcntl.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/types.h>
#include <unistd.h>
#include <errno.h>

// Internals.
#include "footer.h"

#define ALIGN(m, n) (((m) + (n) - 1) & ~((n) - 1))

#define EXIT_WITH_ERROR(msg)		\
	status = 1;			\
	if (errno != 0) {		\
		perror(msg);		\
	} else { 			\
		fprintf(stderr, msg);	\
		fprintf(stderr, "\n");	\
	}				\
	goto cleanup;

#define TRACE(...) 				\
	do {					\
		fprintf(stderr, "wrap:\t");	\
		fprintf(stderr, __VA_ARGS__);	\
		fprintf(stderr, "\n");		\
	} while (false);

// Apend `src` to `dst`.
int append (int src, int dst) {
	char buf[4096] = {0};
	if ((lseek(src, 0, SEEK_SET) < 0) || (lseek(dst, 0, SEEK_END) < 0)) {
		perror("failed to seek");
		return 0;
	}
	for(;;) {
		ssize_t num_read = read(src, buf, 4096);
		if (num_read == 0) {
			return 0;
		}
		if (num_read < 0) {
			perror("failed to read");
			return 1;
		}
		ssize_t num_written = 0;
		while (num_written < num_read) {
			ssize_t n = write(dst, &buf[num_written], num_read - num_written);
			if (n <= 0) {
				perror("failed to write");
				return 1;
			}
			num_written += n;
		}
	}
}

int main(int argc, const char** argv) {
	// Parse args.
	if (argc < 4) {
		fprintf(stderr, "usage is wrap <input> <output> <stub> <manifest>\n");
		return 1;
	}
	const char* input	= argv[1];
	const char* manifest	= argv[2];
	const char* stub	= argv[3];

	// Get OUTPUT.
	const char* output = getenv("OUTPUT");
	if (!output) {
		fprintf(stderr, "missing OUTPUT env var");
		return 1;
	}

	TRACE("input:%s, manifest:%s, stub:%s, output:%s", input, manifest, stub, output);

	// State.
	int status	= 0;
	int output_fd	= 0;
	int input_fd	= 0;
	int stub_fd	= 0;
	int manifest_fd	= 0;
	size_t	output_size = 0;
	void*	elf = NULL;

	// Open the output.
	output_fd = open(output, O_RDWR | O_CREAT);
	if (output_fd < 0) {
		EXIT_WITH_ERROR("failed to open output");
		return 1;
	}

	// Open the input.
	input_fd = open(input, O_RDWR);
	if (input_fd < 0) {
		perror("failed to open input");
		return 1;
	}

	// Open the stub.
	stub_fd = open(stub, O_RDONLY);
	if (stub_fd < 0) {
		EXIT_WITH_ERROR("failed to open stub");
	}
	off_t stub_size = lseek(stub_fd, 0, SEEK_END);
	lseek(stub_fd, 0, SEEK_SET);
	if (stub_size < 0) {
		EXIT_WITH_ERROR("failed to get stub size");
	}

	// Open the manifest.
	manifest_fd = open(manifest, O_RDONLY);
	if (manifest_fd < 0) {
		EXIT_WITH_ERROR("failed to open manifest");
	}
	off_t manifest_size = lseek(manifest_fd, 0, SEEK_END);
	lseek(manifest_fd, 0, SEEK_SET);
	if (manifest_size < 0) {
		EXIT_WITH_ERROR("failed to get manifest size");
	}

	TRACE("opened all files");

	// Copy input to output.
	if (append(input_fd, output_fd)) {
		EXIT_WITH_ERROR("failed to write output");
	}
	TRACE("copied input to output");

	// Seek to the end of the outfile and get its size.
	output_size = lseek(output_fd, 0, SEEK_END);
	if (output_size < 0) {
		EXIT_WITH_ERROR("failed to get output size");
	}
	TRACE("output size: %ld", output_size);

	// Map in the ELF binary.
	elf = mmap(
		NULL, 
		(size_t)output_size, 
		PROT_READ | PROT_WRITE, 
		MAP_SHARED, 
		output_fd, 
		0
	);
	if (elf == MAP_FAILED) {
		EXIT_WITH_ERROR("failed to mmap output");
	}
	TRACE("mapped output");

	// Validate the elf.
	uint8_t* mag = (uint8_t*)elf;
	bool is_elf = mag[0]	== ELFMAG0 
		&& mag[1] 	== ELFMAG1
		&& mag[2] 	== ELFMAG2
		&& mag[3] 	== ELFMAG3;
	is_elf &= (mag[EI_CLASS] == ELFCLASS64);
	is_elf &= (mag[EI_DATA] == ELFDATA2LSB);
	if (!is_elf) {
		EXIT_WITH_ERROR("not a 64bit ELF file");
	}
	TRACE("validated output");
	
	// Get the elf header.
	Elf64_Ehdr* ehdr = (Elf64_Ehdr*)elf;
	
	// Find the PT_INTERP segment and the max virtual address.
	Elf64_Phdr* pt_interp	= NULL;
	Elf64_Phdr* pt_load	= NULL;
	Elf64_Addr vaddr	= 0;
	char* itr = ((char*)elf + ehdr->e_phoff);
	char* end = itr + (ehdr->e_phnum * ehdr->e_phentsize);
	for (; itr != end; itr += ehdr->e_phentsize) {
		Elf64_Phdr* phdr = (Elf64_Phdr*)itr;
		Elf64_Addr end_of_segment = phdr->p_vaddr + phdr->p_memsz;
		if (end_of_segment >= vaddr) {
			vaddr = ALIGN(end_of_segment + 4096, 4096);
		}
		if (phdr->p_type == PT_INTERP) {
			pt_interp = phdr;
		}
		if (phdr->p_type == PT_LOAD) {
			pt_load = phdr;
		}
	}
	TRACE("found PT_INTERP, PT_LOAD, vaddr");

	// Keep track of where we're going to append the stub.
	size_t file_offset = ALIGN(output_size, 4096);
	if (pt_interp) {
		size_t sz = ALIGN(stub_size, 4096);
		// If there is an interpreter, reuse it as PT_LOAD segment.
		pt_interp->p_align	= 0x1000;
		pt_interp->p_filesz	= sz;
		pt_interp->p_flags	= PF_R | PF_X;
		pt_interp->p_memsz	= sz;
		pt_interp->p_offset	= file_offset;
		pt_interp->p_paddr	= vaddr;
		pt_interp->p_type	= PT_LOAD;
		pt_interp->p_vaddr	= vaddr;
	} else {
		EXIT_WITH_ERROR("unimplemented: insert a new PT_LOAD segment and update all offsets");
	}

	// Create the footer.
	Footer footer;
	footer.entry	= ehdr->e_entry;
	footer.size	= manifest_size;
	footer.version	= 1;
	memcpy(&footer.magic, "tangram", 8);
	TRACE("version: %d, size: %d, entry: %d", footer.entry, footer.size, footer.version);
	
	// Patch the entrypoint.
	ehdr->e_entry = vaddr;

	// Unmap
	munmap(elf, output_size);
	elf = NULL;
	TRACE("unmapped output");

	// Truncate.
	if (ftruncate(output_fd, file_offset) < 0) {
		EXIT_WITH_ERROR("failed to resize the output");
	}

	// Append the stub and manifest.
	if (append(stub_fd, output_fd)) {
		EXIT_WITH_ERROR("failed to append stub to output");
	}
	TRACE("appended stub");

	if (append(manifest_fd, output_fd)) {
		EXIT_WITH_ERROR("failed to append manifest to output");
	}
	TRACE("appended manifest");

	// Append the footer.
	if (write(output_fd, (void*)(&footer), sizeof(footer)) != sizeof(footer)) {
		EXIT_WITH_ERROR("failed to append footer to output");
	}
	TRACE("appended footer");

cleanup:
	munmap(elf, output_size);
	close(input_fd);
	close(output_fd);
	close(manifest_fd);
	close(stub_fd);

	TRACE("status: %d", status);
	return status;
}
