#ifdef __aarch64__
#elif defined __x86_64__
#else
#error "unknown architecture"
#endif

#include <stddef.h>
#include <stdint.h>
#include <elf.h>
#include <stdbool.h>

#include "arena.h"
#include "debug.h"
#include "footer.h"
#include "manifest.h"
#include "syscall.h"
#include "util.h"

// Push a value onto the stack pointer.
#define PUSH(sp, val) do { sp -= sizeof(uintptr_t); *((uintptr_t*)sp) = (uintptr_t)val; } while (0)

// Data passed to us on the stack by the kernel, as well as some counters.
typedef struct
{
	void*		sp;	// the stack pointer at the entrypoint.
	int 		argc;	// num args
	char**		argv;	// arg vector
	int 		envc;	// num env vars
	char**		envp;	// env vector
	int 		auxc;	// num aux vals
	Elf64_auxv_t*	auxv;	// the aux vector
	uintptr_t	auxv_glob[32];	// sorted aux vector, for quick lookup later.
} Stack;

typedef struct
{
	bool enable_tracing;
	bool suppress_args;
	bool suppress_env;
} Options;

// Debugging helper.
static void print_stack (Stack* stack) {
	trace("{\n");
	trace("\targc: %d,\n", stack->argc);
	trace("\targv: [\n");
	for (int n = 0; n < stack->argc; n++) {
		trace("\t\t\"%s\",\n", stack->argv[n]);
	}
	trace("\t],\n");
	trace("\tenvp: [\n");
	for (int n = 0; n < stack->envc; n++) {
		trace("\t\t\"%s\",\n", stack->envp[n]);
	}
	trace("\t],\n");
	trace("\tauxv: [\n");
	for (int n = 0; n < stack->auxc; n++) {
		trace("\t\t{ a_type: \"%s\", a_un: %08lx },\n",
			auxv_type_string(stack->auxv[n].a_type),
			stack->auxv[n].a_un.a_val
		);
	}
	trace("\t]\n}\n");
}

static void parse_options(Stack* stack, Options* options) {
	String TANGRAM_SUPPRESS_ARGS = STRING_LITERAL("TANGRAM_SUPPRESS_ARGS");
	String TANGRAM_SUPPRESS_ENV = STRING_LITERAL("TANGRAM_SUPPRESS_ENV");
	String TANGRAM_TRACING = STRING_LITERAL("TANGRAM_TRACING");

	options->enable_tracing = false;
	options->suppress_args = false;
	options->suppress_env = false;

	char **itr, **end;

	// Parse args.
	itr = stack->argv;
	end = itr + stack->argc;
	for(; itr != end; itr++) {
		String s = STRING_LITERAL(*itr);
		if (cstreq(s, "--tangram-suppress-args")) {
			options->suppress_args = true;
		}
		if (cstreq(s, "--tangram-suppress-env")) {
			options->suppress_env = true;
		}
	}

	// Parse envs.
	itr = stack->envp;
	end = itr + stack->envc;
	for(; itr != end; itr++) {
		String s = STRING_LITERAL(*itr);
		if (starts_with(s, TANGRAM_SUPPRESS_ARGS)) {
			options->suppress_args = true;
		}
		if (starts_with(s, TANGRAM_SUPPRESS_ENV)) {
			options->suppress_env = true;
		}
		if (starts_with(s, TANGRAM_TRACING)) {
			options->enable_tracing = true;
		}
	}
}

// Scan the bottom of the stack to extract argv, envp, auxv and their counts.
static void scan_stack (Stack* stack) {
	// Validate alignment.
	ABORT_IF((uintptr_t)stack->sp % 16 != 0, "misaligned stack");

	// Scan the arg vector.
	stack->argc = (int)*(uint64_t *)stack->sp;
	stack->argv = (char**)((int64_t *)stack->sp + 1);

	// Scan the env vector.
	stack->envp = (char**)((int64_t *)stack->sp + 1 + stack->argc + 1);
	stack->envc = 0;
	for (; stack->envp[stack->envc]; stack->envc++){}

	// Scan the aux vector.
	stack->auxv = (Elf64_auxv_t *)((int64_t *)stack->sp + 1 + stack->argc + 1 + stack->envc + 1);
	stack->auxc = 0;
	for(;;) {
		Elf64_auxv_t* v = stack->auxv + stack->auxc;
		stack->auxc++;
		if (v->a_type < 32) {
			stack->auxv_glob[v->a_type] = (uintptr_t)v->a_un.a_val;
		}
		if (v->a_type == AT_NULL) {
			break;
		}
	}
}

// Push a string to the top of the stack.
static inline void push_str (void** sp, const char* str) {
	size_t len = strlen_including_nul(str);
	(*sp) -= len;
	memcpy(*sp, (const void*)str, len);
}

// Push an auxv to the top of the stack.
static inline void push_auxv (void** sp, const Elf64_auxv_t* auxv) {
	(*sp) -= sizeof(Elf64_auxv_t);
	memcpy(*sp, (const void*)auxv, sizeof(Elf64_auxv_t));
}

static inline void print_program_header_table (Elf64_Phdr* phdr, size_t count) {
	trace("count: %d\n", count);
	Elf64_Phdr* itr = phdr;
	Elf64_Phdr* end = itr + count;
	for(; itr != end; itr++) {
		trace("%s flags:%o offset:%lx vaddr:%lx, paddr:%lx, filesz:%lx, memsz:%lx, align: %lx\n" ,
			p_type_string(itr->p_type),
			itr->p_flags,
			itr->p_offset,
			itr->p_vaddr,
			itr->p_paddr,
			itr->p_filesz,
			itr->p_memsz,
			itr->p_align
		);
	}
}

// Create a new execution stack. Currently, this allocates a new stack rather than reusing the existing stack.
static inline void* prepare_stack (
	Arena* arena,
	Stack* stack,
	Manifest* manifest,
	Options* options
) {
	// Get the default stack size using ulimit. TODO: how does this work w/ cgroups?
	rlimit_t rlim;
	ABORT_IF(getrlimit(RLIMIT_STACK, &rlim), "failed to get the stack size");
	size_t stack_size = rlim.soft;

	// Allocate the stack. On x86_64, the stack "grows down" meaning that the address returned by mmap is actually the lowest possible address for the stack. The "top" of the new stack is the address of one page past it.
	void* bp = mmap(
		0,
		stack_size,
		PROT_READ | PROT_WRITE,
		MAP_ANONYMOUS | MAP_PRIVATE | MAP_GROWSDOWN,
		-1,
		0
	);
	void* sp = bp + stack_size;

	// Push environment variables. Order doesn't matter.
	int e = 0;
	char** envp = ALLOC_N(arena, manifest->env.size + 1, char*);

	// Add envs.
	for (int i = 0; i < manifest->env.capacity; i++) {
		Node* node = manifest->env.list + i;
		while(node) {
			if (node->key.ptr) {
				// Allocate the string.
				size_t len = node->key.len + node->val.len + 2;
				char* str = (char*)alloc(arena, len, 1);
				memset(str, 0, len);

				// Create the string.
				memcpy(str, node->key.ptr, node->key.len);
				str[node->key.len] = '=';
				memcpy(str + node->key.len + 1, node->val.ptr, node->val.len);

				// Push the string onto the stack.
				push_str(&sp, str);

				// Save the address in envp.
				envp[e++] = sp;
			}
			node = node->next;
		}
	}

	// Push arg vector. Order still does not matter.
	int a = 0;
	char** argv = ALLOC_N(arena, manifest->argc + 8, char*);

	// Add argv0
	push_str(&sp, stack->argv[0]);
	argv[a++] = sp;

	for (int i = 0; i < manifest->argc; i++) {
		char* arg = cstr(arena, manifest->argv[i]);
		push_str(&sp, arg);
		argv[a++] = sp;
	}

	// Push 16 null bytes.
	PUSH(sp, 0ul);
	PUSH(sp, 0ul);

	// Align the stack.
	sp = (void*)ALIGN((uintptr_t)sp, 16);

	// If there are an even number of env and arg vals then we need an additional 8 bytes of padding to ensure the top of the stack is aligned.
	if ((e + a) % 2 == 0) {
		PUSH(sp, 0);
	}

	// Push aux vector in reverse order.
	int x = stack->auxc;
	for (; x >= 0; x--) {
		Elf64_auxv_t* v = &stack->auxv[x];
		push_auxv(&sp, v);
	}

	// Null separator between envp and auxv.
	PUSH(sp, 0);

	// Push envp, in reverse order.
	for (int e_ = e - 1; e_ >= 0; e_--) {
		ABORT_IF(!envp[e_], "invalid env pointer");
		PUSH(sp, envp[e_]);
	}

	// Null separator between argv and envp.
	PUSH(sp, NULL);

	// Push argv, in reverse order.
	for (int a_ = a - 1; a_ >= 0; a_--) {
		PUSH(sp, argv[a_]);
	}

	// Push argc.
	PUSH(sp, (uint64_t)a);

	// Check alignment.
	if ((uintptr_t)sp % 16) {
		ABORT("misaligned stack");
	}

	// Return the prepared stack.
	return sp;
}

typedef struct {
	uintptr_t phdr;
	uintptr_t phnum;
	uintptr_t entry;
	uintptr_t base_address;
} LoadedInterpreter;

// Given the absolute path to the interpreter on disk, we load it into memory, returning its entrypoint and base address.
static LoadedInterpreter load_interpreter(
	Arena* arena,
	const char* path,
	uint64_t page_sz,
	Options* options
) {
	if (options->enable_tracing) {
		trace("loading interpreter with path: %s, page_sz: %ld\n", path, page_sz);
	}

	// Open the interpreter.
	int fd = open(path, O_RDONLY, 0);
	ABORT_IF(fd < 0, "failed to open interpreter %s", path);

	// Read the e_hdr
	Elf64_Ehdr* ehdr = ALLOC(arena, Elf64_Ehdr);
	read_all(options->enable_tracing, fd, (char*)ehdr, sizeof(Elf64_Ehdr), 0);

	// Validate
	bool is_elf64 = (ehdr->e_ident[EI_MAG0] == ELFMAG0)
		&& (ehdr->e_ident[EI_MAG1] == ELFMAG1)
		&& (ehdr->e_ident[EI_MAG2] == ELFMAG2)
		&& (ehdr->e_ident[EI_MAG3] == ELFMAG3)
		&& (ehdr->e_ident[EI_DATA] == ELFDATA2LSB)
		&& (ehdr->e_ident[EI_CLASS] == ELFCLASS64);
	ABORT_IF(!is_elf64, "invalid ELF file");
	ABORT_IF(ehdr->e_phentsize != sizeof(Elf64_Phdr),
		"e_phentsize=%ld,  sizeof(Elf64_Phdr)=%ld",
		ehdr->e_phentsize, sizeof(Elf64_Phdr)
	);

	// Get the program header table.
	Elf64_Phdr* phdr = ALLOC_N(arena, ehdr->e_phnum, Elf64_Phdr);
	read_all(options->enable_tracing, fd, (char*)phdr, sizeof(Elf64_Phdr) * ehdr->e_phnum, ehdr->e_phoff);

	// We scan the program header table looking for the address range it should be mapped to.
	uint64_t minvaddr = (uint64_t)-1;
	uint64_t maxvaddr = 0;
	switch(ehdr->e_type) {
		case ET_DYN: {
			// For dynamic interpreters, search for the address range.
			Elf64_Phdr* itr = phdr;
			Elf64_Phdr* end = itr + ehdr->e_phnum;
			for (; itr != end; itr++) {
				if (itr->p_type != PT_LOAD) {
					continue;
				}
				uint64_t min = itr->p_vaddr;
				uint64_t max = min + itr->p_memsz;
				if (min < minvaddr) {
					minvaddr = min;
				}
				if (max > maxvaddr) {
					maxvaddr = max;
				}
			}
			break;
		}
		default: ABORT("invalid interpreter e_type"); // TODO: static interpreters?
	}
	if (options->enable_tracing) {
		trace("loader virtual address range: %08lx..%08lx\n", minvaddr, maxvaddr);
	}

	// Create one big mapping for the entire interpreter with PROT_NONE permissions. We'll slice it up in a second.
	void* base_address = mmap(0, ALIGN(maxvaddr, page_sz), 0, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
	if (options->enable_tracing) {
		trace("mapped %08lx..%08lx", (uintptr_t)base_address, (uintptr_t)base_address + maxvaddr);
	}

	// Compute the bias, the logical base address of the interpeter.
	void* bias = base_address - minvaddr;

	// Begin mapping PT_LOAD segments.
	uint64_t mask = page_sz - 1;
	Elf64_Phdr* itr = phdr;
	Elf64_Phdr* end = phdr + ehdr->e_phnum;
	Elf64_Addr phdr_addr = 0;
	for (; itr != end; itr++) {
		// Skip non-loadable segments.
		if (itr->p_type != PT_LOAD) { continue; }

		// Get the physical offset in the file.
		uint64_t offset = itr->p_offset;

		// The file offset may be misaligned.
		uint64_t misalignment = (offset & mask);

		// Compute the (aligned) file offset.
		off_t file_offset = offset - misalignment;

		// Compute the (aligned) virtual address.
		void* segment_address = (void*)((char*)bias + itr->p_vaddr - misalignment);

		// Compute the protection flags for this segment.
		uint64_t prot = 0;
		if (itr->p_flags & PF_R) { prot |= PROT_READ;  };
		if (itr->p_flags & PF_W) { prot |= PROT_WRITE; };
		if (itr->p_flags & PF_X) { prot |= PROT_EXEC;  };

		// Compute the file size that we will map in.
		uintptr_t filesz = ALIGN(itr->p_filesz + misalignment, page_sz);
		uintptr_t memsz  = ALIGN(itr->p_memsz + misalignment, page_sz);

		// If there's a non-zero number of bytes in the file, mmap it in.
		size_t mapped = 0;
		if (itr->p_filesz) {
			uint64_t flags = (prot & PROT_WRITE) ? MAP_PRIVATE : MAP_SHARED;
			segment_address = mmap(
				segment_address,
				filesz,
				prot,
				MAP_FIXED | flags,
				fd,
				file_offset
			);
			if (segment_address == MAP_FAILED) ABORT("mmap failed");
			mapped += filesz;
		}

		// If we need more memory than was mapped from the file, allocate it.
		if (memsz > filesz) {
			uintptr_t start = (uintptr_t)segment_address + filesz;
			uintptr_t end = start + (memsz - filesz);
			void* p = mmap(
				(void*)start,
				(end - start),
				prot,
				MAP_FIXED | MAP_ANONYMOUS | MAP_PRIVATE,
				-1,
				0
			);
			if (p == MAP_FAILED) ABORT("mmap failed");
			mapped += (memsz - filesz);
		}

		// If the page is marked writeable, make sure to zero-out any excess between the file end and the end of the segment.
		if (prot & PF_W) {
			uintptr_t offset = misalignment + itr->p_filesz;
			uintptr_t length = mapped - itr->p_filesz - misalignment;
			void* dst = (void*)((char*)segment_address + offset);
			memset(dst, 0, length);
		}

		// Sanity check our work.
		ABORT_IF(mapped < itr->p_memsz, "failed to map segment");

		if (options->enable_tracing) {
			trace("LOADER: %08lx..%08lx to %08lx..%08lx %03o\n",
				itr->p_vaddr, itr->p_vaddr + itr->p_memsz,
				(uintptr_t)segment_address, (uintptr_t)(segment_address + mapped),
				prot
			);
		}

		// If this segment contains the phdr address, update it.
		uint64_t file_start = itr->p_offset;
		uint64_t file_end   = file_start + itr->p_filesz;
		if (file_start <= ehdr->e_phoff && file_end <= (ehdr->e_phoff + ehdr->e_phentsize)) {
			// Find the offset from the start of this segment of the program headers.
			uint64_t ph_off_from_vaddr = ehdr->e_phoff - file_start;
			phdr_addr = (uintptr_t)segment_address + ph_off_from_vaddr;
		}
	}

	// Get the entrypoint.
	LoadedInterpreter loaded = {
		.phdr  = phdr_addr,
		.phnum = ehdr->e_phnum,
		.entry = (uintptr_t)ehdr->e_entry,
		.base_address = (uintptr_t)bias
	};

	if (options->enable_tracing) {
		trace("loaded interpreter: phdr: %lx, phnum: %d, entry: %lx, base_address: %lx\n",
			loaded.phdr,
			loaded.phnum,
			loaded.entry,
			loaded.base_address
		);
	}

	// Close the file.
	close(fd);

	// Return the entrypoint.
	return loaded;
}

typedef struct {
	Elf64_Phdr*	new;
	uint64_t	num;
} ProgramHeaders;

static ProgramHeaders create_program_headers(
	Arena* arena,
	Manifest* manifest,
	void* base_address,
	uintptr_t original_entrypoint,
	Elf64_Phdr* old,
	size_t num
) {
	Elf64_Phdr* new = ALLOC_N(arena, num + 1, Elf64_Phdr);
	Elf64_Phdr* itr = old;
	Elf64_Phdr* end = old + num;
	uint64_t n = 0;
	for(; itr != end; itr++) {
		// If this is the load segment containing the stub, skip it. We don't want the loader to load it.
		if (itr->p_type == PT_LOAD
			&& itr->p_vaddr <= original_entrypoint
			&& original_entrypoint < itr->p_vaddr + itr->p_memsz
		) {
			continue;
		}

		// Duplicate the header data.
		memcpy(&new[n], itr, sizeof(Elf64_Phdr));

		// Patch the PT_PHDR virtual address with our new virtual address.
		if (itr->p_type == PT_PHDR) {
			ABORT_IF(itr != old, "PT_PHDR must appear first");
			new[n].p_vaddr = (uintptr_t)new - (uintptr_t)base_address;
		}

		n++;
	}

	// Add a pt_interp header at the end.
	if (manifest && manifest->interpreter.ptr) {
		char* interp = alloc(arena, manifest->interpreter.len + 1, 1);
		memcpy(interp, manifest->interpreter.ptr, manifest->interpreter.len);
		memset((void*)&new[n], 0, sizeof(Elf64_Phdr));
		new[n].p_type  = PT_INTERP;
		new[n].p_vaddr = (uintptr_t)interp - (uintptr_t)base_address;
		new[n].p_paddr = new[n].p_vaddr;
		new[n].p_align = 1;
		new[n].p_filesz = 0;
		new[n].p_memsz = manifest->interpreter.len;
		new[n].p_flags = PF_R;
		n++;
	}

	// Return the new phdr vector.
	ProgramHeaders new_phdrs = {
		.new = new,
		.num = n
	};
	return new_phdrs;
}

// Handle the manifest.
typedef struct {
	Elf64_Ehdr* elf_header;
	Elf64_Phdr* program_headers;
	Elf64_Shdr* section_headers;
	char* section_string_table;
	Manifest* manifest;
	Footer* footer;
} Executable;

static int read_executable (
	Arena* arena,
	Stack* stack,
	Options* options,
	Executable* executable
) {
	// Initialize envp.
	create_table(arena, &executable->manifest->env, 4096);
	if (options->enable_tracing) {
		trace("created env\n");
	}

	// Fill the env table.
	if (!options->suppress_env) {
		for (int i = 0; i < stack->envc; i++) {
			char* e = stack->envp[i];

			// Find the length and midpoint of the env var.
			size_t n = 0;
			size_t m = 0;
			for (; e[n]; n++) {
				if (e[n] == '=') {
					m = n;
				}
			}

			// No '=' found. Skip it.
			if (m == 0) {
				continue;
			}

			// Allocate strings for key/value pair.
			String key = {0};
			key.ptr = ALLOC_N(arena, m + 1, uint8_t);
			key.len = m;
			memcpy(key.ptr, e, m);

			String val = {0};
			val.ptr = ALLOC_N(arena, n - m, uint8_t);
			val.len = n - m - 1;
			memcpy(val.ptr, e + m + 1, n - m - 1);

			insert(arena, &executable->manifest->env, key, val);
		}
		if (options->enable_tracing) {
			trace("initialized env\n");
		}
	}

	// Read the manifest. TODO: use loadable segment?
	int fd = open("/proc/self/exe", O_RDONLY, 0);
	off_t offset = 0;

	// Read the elf header. We don't need to do any validation here, we assume the kernel didn't lie.
	read_all(options->enable_tracing, fd, (char*)executable->elf_header, sizeof(Elf64_Ehdr), 0);

	// Read the program header table.
	offset = executable->elf_header->e_phoff;
	size_t size = executable->elf_header->e_phnum * sizeof(Elf64_Phdr);
	executable->program_headers = ALLOC_N(arena, executable->elf_header->e_phnum, Elf64_Phdr);
	read_all(options->enable_tracing, fd, (char*)executable->program_headers, size, offset);

	// Read the section header table.
	offset = executable->elf_header->e_shoff;
	size = executable->elf_header->e_shnum * sizeof(Elf64_Shdr);
	executable->section_headers = ALLOC_N(arena, executable->elf_header->e_shnum, Elf64_Shdr);
	read_all(options->enable_tracing, fd, (char*)executable->section_headers, size, offset);

	// Read the section header string table.
	Elf64_Shdr* section = executable->section_headers + executable->elf_header->e_shstrndx;
	offset = section->sh_offset;
	size = section->sh_size;
	executable->section_string_table = ALLOC_N(arena, size, char);
	read_all(options->enable_tracing, fd, (char*)executable->section_string_table, size, offset);

	// Get the file size.
	offset = lseek(fd, 0, SEEK_END);
	if (offset < 0) {
		ABORT("failed to seek");
	}
	if (options->enable_tracing) {
		trace("file size: %d\n", offset);
	}

	// Look for the manifest in the executable sections.
	char* data = NULL;

	Elf64_Shdr* section_itr = executable->section_headers;
	Elf64_Shdr* section_end = section_itr + executable->elf_header->e_shnum;
	String TANGRAM_MANIFEST_SECTION_NAME = STRING_LITERAL(".note.tg-manifest");
	for (; section_itr != section_end; section_itr++) {
		String name = {0};
		name.ptr = &executable->section_string_table[section_itr->sh_name];
		name.len = strlen(name.ptr);
		if (options->enable_tracing) {
			trace("found section ");
			print_json_string(&name);
			trace("\n");
		}
		if (streq(name, TANGRAM_MANIFEST_SECTION_NAME)) {
			data	= alloc(arena, section_itr->sh_size, 1);
			size	= section_itr->sh_size;
			offset	= section_itr->sh_offset;
			if (options->enable_tracing) {
				trace("reading manifest at offset: %ld, size: %ld\n", offset, size);
			}
			read_all(options->enable_tracing, fd, data, size, offset);
			memcpy((void*)executable->footer, (void*)(data + (size - sizeof(Footer))), sizeof(Footer));
			break;
		}
	}
	ABORT_IF(!data, "failed to find manifest section");

	// Close the file.
	close(fd);

	// Print the manifest if provided.
	if (options->enable_tracing) {
		trace("manifest: \n");
		for (int ch = 0; ch < executable->footer->size; ch++) {
			trace("%c", data[ch]);
		}
		trace("\n");
	}

	// Parse the manifest.
	parse_manifest(arena, executable->manifest, (uint8_t*)data, executable->footer->size);

	// Append the arg list if necessary.
	if (!options->suppress_args) {
		// Allocate a new arg vector.
		String* argv = ALLOC_N(arena, stack->argc + executable->manifest->argc, String);
		size_t argc = 0;

		// Now add the args from the manifest.
		for (size_t n = 0; n < executable->manifest->argc; n++) {
			argv[argc++] = executable->manifest->argv[n];
		}

		// Finally the stack args, not including argv0.
		for (size_t n = 1; n < stack->argc; n++) {
			argv[argc].ptr = stack->argv[n];
			argv[argc].len = strlen(stack->argv[n]);
			argc++;
		}

		// Update the manifest.
		executable->manifest->argv = argv;
		executable->manifest->argc = argc;
	}

	return 1;
}

static int read_footer(Footer* footer) {
	int fd = open("/proc/self/exe", O_RDONLY, 0);
	if (fd < 0) {
		return 1;
	}
	off_t sz = lseek(fd, 0, SEEK_END);
	if (sz < 0) {
		return 1;
	}
	if (pread64(fd, (void*)footer, sizeof(Footer), sz - sizeof(Footer)) != sizeof(Footer)) {
		return 1;
	}
	close(fd);
	return 0;
}

static void exec (Arena* arena, Manifest* manifest, char* argv0, Options* options) {
	// Sanity check.
	ABORT_IF(!manifest->executable.ptr, "missing executable");
	ABORT_IF(!argv0, "missing argv0");

	// Get the executable path.
	char* pathname = manifest->interpreter.ptr
		? cstr(arena, manifest->interpreter)
		: cstr(arena, manifest->executable);

	// Compute argc.
	size_t argc = manifest->argc
		+ manifest->interp_argc
		+ 1  // pathname
		+ 1  // --argv0
		+ 1  // argv[0]
		+ 1  // --
		+ 1; // executable

	// Create argv, envp
	char** argv = ALLOC_N(arena, argc + 1, char*);
	char** envp = ALLOC_N(arena, manifest->env.size + 1, char*);

	// Fill argv.
	size_t n = 0;
	argv[n++] = pathname;
	if (manifest->interpreter.ptr) {
		for (int i = 0; i < manifest->interp_argc; i++) {
			argv[n++] = cstr(arena, manifest->interp_argv[i]);
		}
		argv[n++] = "--argv0";
		argv[n++] = argv0;
		if (manifest->interpreter_kind == INTERPRETER_KIND_LD_MUSL){
			argv[n++] = "--";
		}
		argv[n++] = cstr(arena, manifest->executable);
	}
	for (int i = 0; i < manifest->argc; i++) {
		argv[n++] = cstr(arena, manifest->argv[i]);
	}
	argv[n++] = NULL;

	// Fill envp.
	size_t e = 0;
	for (int i = 0; i < manifest->env.capacity; i++) {
		Node* node = manifest->env.list + i;
		while(node) {
			if (node->key.ptr) {
				// Allocate the string.
				size_t len = node->key.len + node->val.len + 2;
				char* str = ALLOC_N(arena, len, char);
				memset(str, 0, len);

				// Create the string.
				memcpy(str, node->key.ptr, node->key.len);
				str[node->key.len] = '=';
				memcpy(str + node->key.len + 1, node->val.ptr, node->val.len);

				// Save the address in envp.
				envp[e++] = str;
			}
			node = node->next;
		}
	}
	envp[e++] = NULL;
	if (options->enable_tracing) {
		trace("about to exec...\n");
		trace("pathname = %s\n", pathname);
		for (int i = 0; i < argc; i++) {
			trace("argv[%d] = %s\n", i, argv[i]);
		}
		for (int i = 0; i < e; i++) {
			trace("envp[%d] = %s\n", i, envp[i]);
		}
	}
	int ec = execve(pathname, argv, envp);
	ABORT("execve failed: %d", ec);
}

// Main entrypoint.
void main (void *sp) {
	// State.
	Arena arena = {0};
	Footer footer = {0};
	Stack stack = {0};
	Options options = {0};

	// Set the stack pointer.
	stack.sp = sp;

	// Scan the stack to collect argv/envp/auxiv.
	scan_stack(&stack);

	// Parse options.
	parse_options(&stack, &options);
	if (options.enable_tracing) {
		trace(
			"options: enable_tracing:%d, suppress_args:%d, suppress_env:%d\n",
			options.enable_tracing, options.suppress_args, options.suppress_env
		);
		trace("original stack:\n");
		print_stack(&stack);

	}

	// We only grab the page size from the aux vector, we'll read the program headers later.
	uint64_t page_sz = (uint64_t)stack.auxv_glob[AT_PAGESZ];
	page_sz = page_sz ? page_sz : 4096;

	// Initialize the arena.
	create_arena(&arena, page_sz);
	if (options.enable_tracing) {
		trace("initialized arena\n");
	}

	// Search for the positions of AT_ENTRY, AT_BASE, AT_PHDR, AT_PHNUM
	int nentry = -1;
	int nbase = -1;
	int nphdr = -1;
	int nphnum = -1;
	for (int i = 0; i < stack.auxc; i++) {
		if (nentry >= 0 && nbase >= 0) {
			break;
		}
		switch(stack.auxv[i].a_type) {
			case AT_PHDR: {
				ABORT_IF(nphdr >= 0, "duplicate AT_PHDR");
				nphdr = i;
				break;
			}
			case AT_PHNUM: {
				ABORT_IF(nphnum >= 0, "duplicate AT_PHNUM");
				nphnum = i;
				break;
			}
			case AT_ENTRY: {
				ABORT_IF(nentry >= 0, "duplicate AT_ENTRY");
				nentry = i;
				break;
			}
			case AT_BASE: {
				ABORT_IF(nbase >= 0, "duplicate AT_BASE");
				nbase = i;
				break;
			}
			default: break;
		}
	}

	// Check that we have space to write the new program header table and number of entries later.
	ABORT_IF(!nphdr || nentry < 0, "missing AT_PHDR or AT_ENTRY");

	// Read the executable and manifest.
	Executable executable = {
		.manifest	 = ALLOC(&arena, Manifest),
		.elf_header	 = ALLOC(&arena, Elf64_Ehdr),
		.program_headers = NULL,
		.section_headers = NULL,
		.section_string_table = NULL,
		.footer		= &footer
	};
	if (!read_executable(&arena, &stack, &options, &executable)) {
		ABORT("failed to parse manifest");
	}
	if (options.enable_tracing) {
		trace("read executable\n");
	}

	// Compute the base address. Normally this is computed using the program header table supplied in the aux vector, but this could be garbage if using a patched program header table.
	uintptr_t load_address = stack.auxv_glob[AT_ENTRY] - executable.elf_header->e_entry;

	// If "--tangram-print-manifest" was passed to the stub, dump the manifest and exit.
	String arg = STRING_LITERAL("--tangram-print-manifest");
	for (int i = 1; i < stack.argc; i++) {
		if (cstreq(arg, stack.argv[i])) {
			print_manifest(executable.manifest);
			exit(0);
		}
	}

	// If the executable is a string, fallback on execve.
	if (executable.manifest->executable.ptr) {
		exec(&arena, executable.manifest, stack.argv[0], &options);
	}
	ABORT_IF(!executable.manifest->entrypoint, "missing entrypoint");

	// Get the entrypoint.
	void* entrypoint = NULL;
	if (executable.manifest->interpreter.ptr) {
		// If there's an interpreter arg,
		stack.auxv[nentry].a_un.a_val = load_address + executable.manifest->entrypoint;

		// Load the interpreter.
		LoadedInterpreter loaded = load_interpreter(&arena, executable.manifest->interpreter.ptr, page_sz, &options);

		// Update the AT_BASE entry of the aux vector.
		if (nbase >= 0) {
			stack.auxv[nbase].a_un.a_val = loaded.base_address;
		}

		// Set the entrypoint as the interpreter.
		entrypoint = (void*)(loaded.base_address + loaded.entry);
	} else {
		entrypoint = (void*)((uintptr_t)load_address + executable.manifest->entrypoint);
	}

	// Fix program headers.
	Arena preserved_memory;
	create_arena(&preserved_memory, page_sz);
	ProgramHeaders new_phdrs = create_program_headers(
		&preserved_memory,
		executable.manifest,
		(void*)load_address,
		stack.auxv[nentry].a_un.a_val,
		executable.program_headers,
		executable.elf_header->e_phnum
	);
	stack.auxv[nphdr].a_un.a_val = (uintptr_t)new_phdrs.new;
	stack.auxv[nphnum].a_un.a_val = (uintptr_t)new_phdrs.num;

	// Prepare a new stack.
	sp = prepare_stack(&arena, &stack, executable.manifest, &options);
	if (options.enable_tracing) {
		Stack dbg_stack = { .sp = sp };
		scan_stack(&dbg_stack);
		trace("new stack:\n");
		print_stack(&dbg_stack);
	}

	// Cleanup all the memory we allocatd.
	destroy_arena(&arena);

	// Jump to the new entrypoint.
	if (options.enable_tracing) {
		trace("about to transfer control\n");
		trace("entrypoint: 0x%lx\n", (uintptr_t)entrypoint);
	}

	jump_to_entrypoint(sp, entrypoint);
}
