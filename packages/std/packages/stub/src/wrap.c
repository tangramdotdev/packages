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
#include <assert.h>

// Internals.
#include "footer.h"

// Convert a PT_xxx value to a string.
static inline const char* p_type_string (uint64_t p_type) {
	switch (p_type) {
		case PT_NULL:		return "PT_NULL";
		case PT_LOAD:		return "PT_LOAD";
		case PT_DYNAMIC:	return "PT_DYNAMIC";
		case PT_INTERP:		return "PT_INTERP";
		case PT_NOTE:		return "PT_NOTE";
		case PT_SHLIB:		return "PT_SHLIB";
		case PT_PHDR:		return "PT_PHDR";
		case PT_TLS:		return "PT_TLS";
		case PT_NUM:		return "PT_NUM";
		case PT_GNU_EH_FRAME:	return "PT_GNU_EH_FRAME";
		case PT_GNU_STACK:	return "PT_GNU_STACK";
		case PT_GNU_RELRO:	return "PT_GNU_RELRO";
		case PT_GNU_PROPERTY:	return "PT_GNU_PROPERTY";
		case PT_SUNWBSS:	return "PT_SUNWBSS";
		case PT_SUNWSTACK:	return "PT_SUNWSTACK";
		case PT_HISUNW:		return "PT_HISUNW";
		default: 		return "UNKNOWN";
	}
}

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

// Bubble sort loadable segments
void sort_segments (Elf64_Phdr* phdr, size_t num) {
	TRACE("num segments = %d", num);
	Elf64_Addr start_addr, end_addr;
	for(;;) {
		bool swapped = false;
		for (int n = 0; n < (num - 1); n++) {
			if (phdr[n].p_type != PT_LOAD || phdr[n+1].p_type != PT_LOAD) {
				fprintf(stderr, "oh fuck");
			}
			end_addr = phdr[n].p_vaddr + phdr[n].p_memsz;
			start_addr = phdr[n + 1].p_vaddr;
			TRACE("phdr[%d].end = %lx, phdr[%d].start = %lx", n, end_addr, n + 1, start_addr);
			if (end_addr > start_addr) {
				TRACE("swap phdr[%d], phdr[%d]", n, n+1);
				Elf64_Phdr tmp = phdr[n];
				phdr[n] = phdr[n+1];
				phdr[n + 1] = tmp;
				swapped = true;
			}
		}
		if (!swapped) {
			break;
		}
	}
}

int main(int argc, const char** argv) {
	// Parse args.
	if (argc < 5) {
		fprintf(stderr, "usage is wrap <input> <manifest> <stub> <output>\n");
		return 1;
	}
	const char* input	= argv[1];
	const char* manifest	= argv[2];
	const char* stub	= argv[3];
	const char* output	= argv[4];

	TRACE("input: %s", input);
	TRACE("manifest: %s", manifest);
	TRACE("stub: %s", stub);
	TRACE("output: %s", output);

	// State.
	int status	= 0;
	int output_fd	= 0;
	int input_fd	= 0;
	int stub_fd	= 0;
	int manifest_fd	= 0;
	size_t	output_size = 0;
	void*	elf = NULL;

	// Open the output.
	output_fd = open(output, O_RDWR | O_CREAT, 0775);
	if (output_fd < 0) {
		EXIT_WITH_ERROR("failed to open output");
		return 1;
	}

	// Open the input.
	input_fd = open(input, O_RDONLY);
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

	Elf64_Phdr* old_phdr = (Elf64_Phdr*)((char*)ehdr + ehdr->e_phoff);
	
	// Find the PT_INTERP segment and the max virtual address.
	Elf64_Phdr* pt_interp	= NULL;
	Elf64_Phdr* pt_load	= NULL;
	Elf64_Addr vaddr	= 0;
	char* itr = (char*)old_phdr;
	char* end = itr + (ehdr->e_phnum * ehdr->e_phentsize);
	int n = 0;
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

	// Get the segment that we'll write the stub to.
	Elf64_Phdr* segment  = pt_interp;
		
	// We may need to append a program header table to the start of the stub.
	Elf64_Phdr* new_phdr   = NULL;
	size_t new_phdr_offset = 0;
	size_t new_phdr_sz     = 0;
	int new_phdr_num       = 0;

	// If there is no pt_interp, create a new program header table.
	bool update_pt_phdr = false;
	if (!segment) {
		TRACE("no PT_INTERP, creating new program header table");

		// Align the new program header table to the pagesize.
		new_phdr_offset = ALIGN(new_phdr_offset, 64);

		// Compute the size of the new program header table.
		new_phdr_sz = (ehdr->e_phnum + 1) * ehdr->e_phentsize;

		// Allocate.
		new_phdr = (Elf64_Phdr*)malloc(new_phdr_sz);
		
		// Offset from 1, to account for the new PT_PHDR.
		new_phdr_num++;

		// Fill in PT_LOAD segments first, skipping the first entry.
		for (int i = 0; i < ehdr->e_phnum; i++) {
			if (old_phdr[i].p_type == PT_PHDR) {
				EXIT_WITH_ERROR("unexpected PT_PHDR");
			}
			if (old_phdr[i].p_type != PT_LOAD) {
				continue;
			}
			new_phdr[new_phdr_num++] = old_phdr[i];
		}
		segment = &new_phdr[new_phdr_num++];
		for (int i = 0; i < ehdr->e_phnum; i++) {
			if (old_phdr[i].p_type == old_phdr[i].p_type == PT_LOAD) {
				continue;
			}
			new_phdr[new_phdr_num++] = old_phdr[i];
		}
	}
	
	// Find out where we're going to write the stub.
	size_t stub_offset = new_phdr 
		? new_phdr[0].p_offset + new_phdr[0].p_filesz
		: ALIGN(output_size, 4096);
	TRACE("stub offset: %d", stub_offset);
	
	// Make the stub size page-aligned, as a sanity check.
	size_t sz = ALIGN(stub_size + new_phdr_sz, 4096);
	TRACE("stub offset: %d", stub_offset);
	
	// Create segment for the stub.
	segment->p_type   = PT_LOAD;
	segment->p_flags  = PF_R | PF_X;
	segment->p_align  = 0x1000;
	segment->p_offset = stub_offset;
	segment->p_paddr  = vaddr;
	segment->p_vaddr  = vaddr;
	segment->p_filesz = sz;
	segment->p_memsz  = sz;

	// Create the footer.
	Footer footer;
	footer.entry	= ehdr->e_entry;
	footer.size	= manifest_size;
	footer.version	= 1;
	memcpy(&footer.magic, "tangram", 8);
	TRACE("entry: %ld, size: %ld, version: %ld", footer.entry, footer.size, footer.version);
	
	// Patch the entrypoint.
	ehdr->e_entry = vaddr;

	// Patch the program header table if necessary.
	if (new_phdr){
		ehdr->e_phoff = new_phdr_offset;
		ehdr->e_phnum = new_phdr_num;
	} else {
		// Sort program headers because bad shit happens when you don't.
		Elf64_Phdr* start = NULL;
		size_t num = 0;
		for(int i = 0; i < ehdr->e_phnum; i++) {
			if (old_phdr[i].p_type != PT_LOAD) {
				continue;
			}
			if (!start) {
				start = &old_phdr[i];
			}
			num++;
		}
		sort_segments(start, num);
	}

	// Unmap
	munmap(elf, output_size);
	elf = NULL;
	TRACE("unmapped output");

	// Resize the file.
	if (ftruncate(output_fd, stub_offset) < 0) {
		EXIT_WITH_ERROR("failed to resize the output");
	}

	// Append the new program header table, if it exists.
	if (new_phdr) {
		if (write(output_fd, (void*)new_phdr, new_phdr_sz) != new_phdr_sz) {
			EXIT_WITH_ERROR("failed to append new program header table");
		}
		TRACE("appended new program header table");
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
	close(manifest_fd);
	close(stub_fd);
	close(output_fd);

	TRACE("status: %d", status);
	return status;
}
