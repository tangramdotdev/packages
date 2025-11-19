#define _GNU_SOURCE
#include "footer.h"
#include <elf.h>
#include <fcntl.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <unistd.h>

#ifdef __aarch64__
	#define MACHINE EM_AARCH64
#endif
#ifdef __x86_64__
	#define MACHINE EM_X86_64
#endif

static bool TRACING_ENABLED = false;

#define TRACE(...) if (TRACING_ENABLED) { fprintf(stderr, "wrap: "); fprintf(stderr, __VA_ARGS__); fprintf(stderr, "\n"); }

#define ALIGN(m, n) (((m) + (n) - 1) & ~((n) - 1))

#define ABORT_IF(cond, ...) if (cond) { fprintf(stderr, __VA_ARGS__); abort(); }

#define ABORT_IF_ERRNO(cond, ...) if (cond) {	\
	char msg[1024];				\
	snprintf(msg, 1024, __VA_ARGS__);	\
	perror(msg);				\
	abort();				\
}

#define TANGRAM_STUB_SECTION_NAME ".text.tangram-stub"
#define TANGRAM_MANIFEST_SECTION_NAME ".note.tg-manifest"

typedef struct File File;
struct File {
	int fd;
	off_t sz;
	const char* path;
};

typedef struct Elf Elf;
struct Elf {
	off_t sz;
	Elf64_Ehdr* ehdr;
	Elf64_Phdr* phdr;
	Elf64_Shdr* shdr;
};

typedef struct Analysis Analysis;
struct Analysis {
	Elf64_Phdr*	pt_interp;
	Elf64_Shdr*	tg_manifest;
	Elf64_Shdr*	tg_stub;
	Elf64_Addr	max_vaddr;
	Elf64_Addr	max_align;
};

typedef struct ProgramHeaders ProgramHeaders;
struct ProgramHeaders {
	size_t		offs;
	size_t		sz;
	Elf64_Phdr*	phdr;
	size_t		num;
};

File file_open (const char* path, int flags, int mode) {
	File file = { .path = path };
	file.fd = open(path, flags, mode);
	ABORT_IF_ERRNO(file.fd < 0, "failed to open %s", path);
	file.sz = lseek(file.fd, 0, SEEK_END);
	ABORT_IF_ERRNO(file.sz < 0, "failed to get file size %s", path);
	TRACE("opened %s (fd:%d, sz:%ld)", file.path, file.fd, file.sz);
	return file;
}

void file_close (File file) {
	close(file.fd);
}

Elf elf_read (File file, Elf64_Half machine, bool readonly) {
	Elf elf = {0};
	int flags = readonly ? PROT_READ : PROT_READ | PROT_WRITE;
	elf.ehdr = (Elf64_Ehdr*) mmap (NULL, (size_t) file.sz, flags, MAP_SHARED, file.fd, 0);
	ABORT_IF_ERRNO(elf.ehdr == (Elf64_Ehdr*)MAP_FAILED, "failed to load %s (len:%ld, flags:%x, fd:%d)", file.path, file.sz, flags, file.fd);
	bool is_elf = 
			elf.ehdr->e_ident[EI_MAG0] == ELFMAG0
		&&	elf.ehdr->e_ident[EI_MAG1] == ELFMAG1
		&& 	elf.ehdr->e_ident[EI_MAG2] == ELFMAG2
		&&	elf.ehdr->e_ident[EI_MAG3] == ELFMAG3
		&&	elf.ehdr->e_ident[EI_CLASS] == ELFCLASS64
		&& 	elf.ehdr->e_ident[EI_DATA] == ELFDATA2LSB
		&&	elf.ehdr->e_phentsize == sizeof(Elf64_Phdr);
	ABORT_IF(!is_elf, "not a 64 bit LE elf binary");
	ABORT_IF(elf.ehdr->e_machine != machine, "invalid architecture");
	ABORT_IF(elf.ehdr->e_phentsize != sizeof(Elf64_Phdr), "invalid ELF file");
	ABORT_IF(elf.ehdr->e_shentsize != sizeof(Elf64_Shdr), "invalid ELF file");
	elf.phdr = (Elf64_Phdr*)((char*)elf.ehdr + elf.ehdr->e_phoff);
	elf.shdr = (Elf64_Shdr*)((char*)elf.ehdr + elf.ehdr->e_shoff);
	elf.sz = file.sz;
	return elf;
}

Elf elf_close (Elf elf) {
	munmap((void*)elf.ehdr, elf.sz);
}

void file_concat (File* dst, File src) {
	char buf[2 << 14] = {0};
	ssize_t bytes_read = 0;
	ABORT_IF(lseek(src.fd, 0, SEEK_SET) < 0, "failed to seek %s", src.path);
	ABORT_IF(lseek(dst->fd, 0, SEEK_END) < 0, "failed to seek %s", dst->path);
	while (bytes_read < src.sz) {
		ssize_t n = read(src.fd, buf, sizeof(buf));
		if (n == 0) {
			break;
		}
		ABORT_IF_ERRNO(n < 0, "failed to read from %s", src.path);
		bytes_read += n;
		ssize_t offset = 0;
		while (offset < n) {
			ssize_t m = write(dst->fd, buf + offset, n - offset);
			ABORT_IF(m < 0, "failed to write to %s", dst->path);
			offset += m;
		}
	}
	dst->sz += src.sz;
}

Analysis elf_analyze (Elf elf) {
	Analysis analysis = {0};
	Elf64_Phdr* itr = elf.phdr;
	Elf64_Phdr* end = itr + elf.ehdr->e_phnum;
	int i = 0;
	for(; itr != end; itr++) {
		if (itr->p_type == PT_LOAD) {
			Elf64_Addr end_of_segment = itr->p_vaddr + itr->p_memsz;
			TRACE("phdr[%d] vaddr:%lx memsz:%lx, end:%lx", i++, itr->p_vaddr, itr->p_memsz, end_of_segment);
			if (end_of_segment > analysis.max_vaddr) {
				analysis.max_vaddr = end_of_segment;
			}
			if (itr->p_align > analysis.max_align) {
				analysis.max_align = itr->p_align;
			}
		}
		if (itr->p_type == PT_INTERP) {
			ABORT_IF(analysis.pt_interp, "multiple interpreters found");
			analysis.pt_interp = itr;
		}
	}

	// Get the section header string table.
	Elf64_Shdr* sh_strings = NULL;
	if (elf.ehdr->e_shstrndx == SHN_XINDEX) {
		sh_strings = &elf.shdr[elf.shdr[0].sh_link];
	} else {
		sh_strings = &elf.shdr[elf.ehdr->e_shstrndx];
	}
	ABORT_IF(sh_strings->sh_type != SHT_STRTAB, "expected a string table");

	// Get the list of section names.
	const char* section_names = ((const char*)elf.ehdr) + sh_strings->sh_offset;

	// Find the section headers of the stub and manifest.
	Elf64_Shdr* sitr = elf.shdr;
	Elf64_Shdr* send = sitr + elf.ehdr->e_shnum;
	for(; sitr != send; sitr++) {
		size_t offset = sitr->sh_name + (sitr == elf.shdr ? 1 : 0);
		const char* name = section_names + offset;
		TRACE("section %s: offset:0x%lx, size:0x%lx", 
			name, sitr->sh_offset, sitr->sh_size);
		if (strcmp(name, TANGRAM_STUB_SECTION_NAME) == 0) {
			TRACE("found %s", TANGRAM_STUB_SECTION_NAME);
			analysis.tg_stub = sitr;
		}
		if (strcmp(name, TANGRAM_MANIFEST_SECTION_NAME) == 0) {
			TRACE("found %s", TANGRAM_MANIFEST_SECTION_NAME);
			analysis.tg_manifest = sitr;
		}
	}
	return analysis;
}

// Bubble sort loadable segments
void elf_sort_segments (Elf64_Phdr* phdr, size_t num) {
	TRACE("num segments = %ld", num);
	Elf64_Addr start_addr, end_addr;
	for(;;) {
		bool swapped = false;
		for (int n = 0; n < (num - 1); n++) {
			end_addr   = phdr[n].p_vaddr + phdr[n].p_memsz;
			start_addr = phdr[n + 1].p_vaddr;
			TRACE("phdr[%d].start = %lx, phdr[%d].end = %lx, phdr[%d].start = %lx", n, phdr[n].p_vaddr, n,  end_addr, n + 1, start_addr);
			ABORT_IF(start_addr >= phdr[n].p_vaddr && start_addr < end_addr, "invalid program headers");
			if (end_addr > start_addr) {
				TRACE("swap phdr[%d], phdr[%d]", n, n+1);
				Elf64_Phdr tmp = phdr[n];
				phdr[n] = phdr[n+1];
				phdr[n + 1] = tmp;
				swapped = true;
				TRACE("swapped %d and %d", n, n + 1);
			} else {
				TRACE("skipping %d", n);
			}
		}
		if (!swapped) {
			break;
		}
	}
}

int main (int argc, const char** argv) {
	TRACING_ENABLED = getenv("TANGRAM_TRACING") != NULL;

	// Check args.
	ABORT_IF(argc != 7, "usage is %s <arch> <input> <output> <stub.elf> <stub.bin> <manifest>");

	const char* arch = argv[0];
	Elf64_Half machine = 0;
	if (strcmp(arch, "aarch64") == 0) {
		machine = EM_AARCH64;
	} else if (strcmp(arch, "x86_64")) {
		machine = EM_X86_64;
	} else {
		ABORT_IF(true, "invalid arch, expected one of: aarch64,x86_64 got: %s", arch);
	};

	// Open input/output/stub/manifest.
	File input	= file_open(argv[2], O_RDONLY, 0);
	File output	= file_open(argv[3], O_RDWR, O_CREAT);
	File stub_elf	= file_open(argv[4], O_RDONLY, 0);
	File stub_bin	= file_open(argv[5], O_RDONLY, 0);
	File manifest	= file_open(argv[6], O_RDONLY, 0);
	TRACE( "input:%s,   output:%s,   stub.elf:%s,   stub.bin:%s,   manifest:%s",
		input.path, output.path, stub_elf.path, stub_bin.path, manifest.path);

	// Copy input to output.
	file_concat(&output, input);
	TRACE("copied %s to %s", input.path, output.path);
	
	// Parse the elf files.
	Elf output_exe	= elf_read(output, machine, false);
	TRACE("parsed %s", output.path);
	Elf stub_exe	= elf_read(stub_elf, machine, true);
	TRACE("parsed %s", stub_elf.path);
	
	// Scan the executable for its pt_interp and max vaddr
	Analysis analysis = elf_analyze(output_exe);
	TRACE("analyzed %s: pt_interp:%p, max_vaddr:%lx", output.path, analysis.pt_interp, analysis.max_vaddr);

	// If there's a PT_INTERP we'll overwrite it with the stub's LOAD segment.
	Elf64_Phdr* stub_segment = analysis.pt_interp;
	
	// If there's no pt_interp, create new program headers.
	ProgramHeaders headers	= {0};
	if (!stub_segment) {
		headers.offs = ALIGN(output.sz, 64);
		headers.sz = output_exe.ehdr->e_phnum + 1 * sizeof(Elf64_Phdr);
		headers.phdr = (Elf64_Phdr*)malloc(headers.sz);

		// Copy loadable segments first.
		for (int i = 0; i < output_exe.ehdr->e_phnum; i++) {
			Elf64_Phdr* phdr = &output_exe.phdr[i];
			ABORT_IF(phdr->p_type == PT_PHDR, "unexpected PT_PHDR");
			if (phdr->p_type != PT_LOAD) {
				continue;
			}
			headers.phdr[headers.num++] = *phdr;
		}

		// Save the last loadable segment for the stub.
		stub_segment = &headers.phdr[headers.num++];

		for (int i = 0; i < output_exe.ehdr->e_phnum; i++) {
			Elf64_Phdr* phdr = &output_exe.phdr[i];
			if (phdr->p_type == PT_LOAD) {
				continue;
			}
			headers.phdr[headers.num++] = *phdr;
		}
		TRACE("created new program headers");
	}

	// Compute the offset/size of the stub binary.
	size_t stub_offs = headers.phdr 
		? ALIGN(headers.offs + headers.sz, analysis.max_align)
		: ALIGN(output.sz, analysis.max_align);
	size_t stub_sz = stub_bin.sz + manifest.sz;

	// Create segment for the stub.
	stub_segment->p_type   = PT_LOAD;
	stub_segment->p_flags  = PF_R | PF_X;
	stub_segment->p_align  = analysis.max_align;
	stub_segment->p_offset = stub_offs;
	stub_segment->p_paddr  = ALIGN(analysis.max_vaddr, analysis.max_align);
	stub_segment->p_vaddr  = ALIGN(analysis.max_vaddr, analysis.max_align);
	stub_segment->p_filesz = stub_sz;
	stub_segment->p_memsz  = ALIGN(stub_sz, analysis.max_align);

	TRACE("new segment vaddr: %lx, memsz: %lx offset: %lx, size: %lx", stub_segment->p_vaddr, stub_segment->p_memsz, stub_segment->p_offset, stub_segment->p_filesz);

	// Patch the section headers.
	ABORT_IF(!analysis.tg_stub, "missing stub section");
	analysis.tg_stub->sh_type	= SHT_PROGBITS;
	analysis.tg_stub->sh_flags	= SHF_ALLOC | SHF_EXECINSTR;
	analysis.tg_stub->sh_addr	= stub_segment->p_vaddr;
	analysis.tg_stub->sh_offset	= stub_segment->p_offset;
	analysis.tg_stub->sh_size	= stub_segment->p_filesz;
	analysis.tg_stub->sh_link	= 0;
	analysis.tg_stub->sh_addralign	= analysis.max_align;
	analysis.tg_stub->sh_entsize	= 0;
	TRACE("patched %s: offset:%lx, size:%lx", 
		TANGRAM_STUB_SECTION_NAME, analysis.tg_stub->sh_offset, analysis.tg_stub->sh_size);

	ABORT_IF(!analysis.tg_manifest, "missing manifest section");
	analysis.tg_manifest->sh_type	= SHT_NOTE;
	analysis.tg_manifest->sh_flags	= 0;
	analysis.tg_manifest->sh_addr	= stub_segment->p_vaddr + stub_bin.sz;
	analysis.tg_manifest->sh_offset	= stub_segment->p_offset + stub_bin.sz;
	analysis.tg_manifest->sh_size	= manifest.sz + sizeof(Footer); // the manifest and footer are in the same section
	analysis.tg_manifest->sh_link	= SHN_UNDEF;
	analysis.tg_manifest->sh_addralign = SHN_UNDEF;
	analysis.tg_manifest->sh_entsize = SHN_UNDEF;
	TRACE("patched %s: offset:%lx, size:%lx", 
		TANGRAM_MANIFEST_SECTION_NAME, analysis.tg_manifest->sh_offset, analysis.tg_manifest->sh_size);

	// Create the footer.
	Footer footer = {
		.size = manifest.sz,
		.version = 0
	};
	memcpy(footer.magic, "tangram", 8);

	// Update the entrypoint.
	TRACE("%s entrypoint:%lx", stub_elf.path, stub_exe.ehdr->e_entry);
	output_exe.ehdr->e_entry = stub_segment->p_vaddr + stub_exe.ehdr->e_entry;

	// Patch the program header table if necessary.
	if (headers.phdr) {
		output_exe.ehdr->e_phoff = headers.offs;
		output_exe.ehdr->e_phnum = headers.num;
	} else {
		// Sort program headers.
		Elf64_Phdr* start = NULL;
		size_t num = 0;
		for(int i = 0; i < output_exe.ehdr->e_phnum; i++) {
			if (output_exe.phdr[i].p_type != PT_LOAD) {
				continue;
			}
			if (!start) {
				start = &output_exe.phdr[i];
			}
			num++;
		}
		elf_sort_segments(start, num);
	}

	// Close elf objects.
	elf_close(output_exe);
	elf_close(stub_exe);

	// Resize the output.
	ABORT_IF_ERRNO(ftruncate(output.fd, stub_offs) < 0, "failed to resize %s", output.path);
	TRACE("resized output %ld", stub_offs);

	// Append the new program header table if necessary.
	if (headers.phdr) {
		ABORT_IF_ERRNO(lseek(output.fd, 0, SEEK_END) < 0, "failed to seek %s", output.path);
		ABORT_IF_ERRNO(
			write(output.fd, (void*)headers.phdr, (size_t)headers.sz) != headers.sz,
			"failed to write new program headers to %s", output.path
		);
		TRACE("appended new program header table");
	}

	// Append the stub and manifest.
	file_concat(&output, stub_bin);
	TRACE("appended stub to binary");

	file_concat(&output, manifest);
	TRACE("appended manifest to binary");

	// Append teh footer.
	ABORT_IF_ERRNO(
		write(output.fd, (void*)&footer, sizeof(footer)) != sizeof(footer),
		"failed to append footer to %s", output.path
	);
	TRACE("appended footer to binary");

	// Close files.
	file_close(input);
	file_close(output);
	file_close(stub_elf);
	file_close(stub_bin);
	file_close(manifest);

	return 0;
}
