// The emebdded wrapper stub code.

// Common includes.
#include <stddef.h>
#include <stdint.h>
#include <elf.h>
#include <stdbool.h>

// Internals.
#include "arena.h"
#include "debug.h"
#include "deserialize.h"
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

// Debugging helper.
static void print_stack (Stack* stack) {
	DBG("{\n");
	DBG("\targc: %d,\n", stack->argc);
	DBG("\targv: [\n");
	for (int n = 0; n < stack->argc; n++) {
		DBG("\t\t\"%s\",\n", stack->argv[n]);
	}
	DBG("\t]\n,");
	DBG("\tenvp: [\n");
	for (int n = 0; n < stack->envc; n++) {
		DBG("\t\t\"%s\",\n", stack->envp[n]);
	}
	DBG("\t],\n");
	DBG("\tauxv: [\n");
	for (int n = 0; n < stack->auxc; n++) {
		DBG("\t\t{ a_type: \"%s\", a_un: %08lx },\n",
			auxv_type_string(stack->auxv[n].a_type),
			stack->auxv[n].a_un.a_val
		);
	}
	DBG("\t]\n}\n");
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

// Swap stacks and jump to the entrypoint.
__attribute__((naked))
static void transfer_control (void* stack, void* entrypoint) {
	asm volatile (
		"mov %rdi, %rsp;"	// set the stack pointer.
		"mov $0, %rdx;" 	// clear rdx because we have no cleanup code.
		"xor %rax, %rax;"
		"xor %rbp, %rbp;"	// clear the frame pointer.
		"jmp *%rsi;"		// jump to the entrypoint.
	);
	__builtin_unreachable();
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

static inline void* find_base_address (Elf64_Phdr* phdr, size_t ph_num) {
	if (phdr->p_type != PT_PHDR) ABORT("expected PT_PHDR");
	return phdr - phdr->p_vaddr;
}

// Create a new execution stack. Currently, this allocates a new stack rather than reusing the existing stack.
static inline void* prepare_stack (
	Arena* arena,
	Stack* stack,
	Manifest* manifest
) {
	// Get the default stack size using ulimit. TODO: how does this work w/ cgroups?
	rlimit_t rlim;
	ABORT_IF(getrlimit(RLIMIT_STACK, &rlim), "failed to get the stack size");

	// Allocate the stack. On x86_64, the stack "grows down" meaning that the address returned by mmap is actually the lowest possible address for the stack. The "top" of the new stack is the address of one page past it.
	// TODO: we could use MMAP_GROWSDOWN and get growable stacks. Unsure if this is necessary or even workable.
	// TODO: should we add a guard page for stack overflow?
	void* bp = mmap(
		0,
		(size_t)rlim.soft,
		PROT_READ | PROT_WRITE,
		MAP_ANONYMOUS | MAP_PRIVATE,
		-1,
		0
	);
	void* sp = bp + rlim.soft;
	memset(bp, 0, rlim.soft);

	// Push environment variables. Order doesn't matter.
	int e = 0;
	char** envp = NULL;
	if (manifest)  {
		envp = alloc(arena, manifest->env.size * sizeof(char*) + 1, _Alignof(char*));

		// lol, for backwards compatibility.
		push_str(&sp, "TANGRAM_INJECTION_IDENTITY_PATH=/proc/self/exe");
		envp[e++] = sp;

		// Process envs.
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
	} else {
		envp = ALLOC_N(arena, stack->envc, char*);
		for (; e < stack->envc; e++) {
			// Push the string onto the stack.
			push_str(&sp, stack->envp[e]);

			// Save the address in envp.
			envp[e] = (char*)sp;
		}
	}

	// Push arg vector. Order still does not matter.
	int a = 0;
	char** argv = NULL;
	if (manifest) {
		argv = alloc(arena, sizeof(char*) * (stack->argc + manifest->argc + 1), _Alignof(char*));
		for (; a < stack->argc; a++) {
			push_str(&sp, stack->argv[a]);
			argv[a] = (char*)sp;
		}
		for (; a < manifest->argc + stack->argc; a++) {
			String* arg = manifest->argv + (a - stack->argc);
			sp -= (arg->len + 1);
			memcpy(sp, (void*)arg->ptr, arg->len);
			((char*)sp)[arg->len] = 0;
		}
	} else {
		argv = ALLOC_N(arena, stack->argc, char*);
		for (; a < stack->argc; a++) {
			push_str(&sp, stack->argv[a]);
			argv[a] = (char*)sp;
		}
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
	uint64_t page_sz
) {
	DBG("path:%s, page_sz:%ld\n", path, page_sz);

	// Open the interpreter.
	int fd = open(path, O_RDONLY);
	if (fd < 0) ABORT("failed to open interpreter path: %s", path);

	// Read the e_hdr
	Elf64_Ehdr* ehdr = ALLOC(arena, Elf64_Ehdr);
	if (pread64(fd, (void*)ehdr, sizeof(Elf64_Ehdr), 0) < 0) ABORT("failed to read ehdr");

	// Validate
	bool is_elf64 = (ehdr->e_ident[EI_MAG0] == ELFMAG0)
		&& (ehdr->e_ident[EI_MAG1] == ELFMAG1)
		&& (ehdr->e_ident[EI_MAG2] == ELFMAG2)
		&& (ehdr->e_ident[EI_MAG3] == ELFMAG3)
		&& (ehdr->e_ident[EI_DATA] == ELFDATA2LSB)
		&& (ehdr->e_ident[EI_CLASS] == ELFCLASS64);
	if (!is_elf64) ABORT("invalid ELF file");
	if (ehdr->e_phentsize != sizeof(Elf64_Phdr)) ABORT(
		"e_phentsize=%ld,  sizeof(Elf64_Phdr)=%ld",
		ehdr->e_phentsize, sizeof(Elf64_Phdr)
	);

	// Get the program header table.
	Elf64_Phdr* phdr = ALLOC_N(arena, ehdr->e_phnum, Elf64_Phdr);
	if (pread64(fd, (void*)phdr, sizeof(Elf64_Phdr) * ehdr->e_phnum, ehdr->e_phoff) < 0) ABORT("failed to read phdr");

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
	DBG("loader virtual address range: %08lx..%08lx\n", minvaddr, maxvaddr);

	// Create one big mapping for the entire interpreter with PROT_NONE permissions. We'll slice it up in a second.
	void* base_address = mmap(0, ALIGN(maxvaddr, page_sz), 0, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
	DBG("mapped %08lx..%08lx", (uintptr_t)base_address, (uintptr_t)base_address + maxvaddr);

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
			segment_address = mmap(
				segment_address,
				filesz,
				prot,
				MAP_FIXED | MAP_PRIVATE,
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
			DBG("mapping extra memory from %08lx .. %08lx", start, end);
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

		DBG("LOADER: %08lx..%08lx to %08lx..%08lx %03o\n",
			itr->p_vaddr, itr->p_vaddr + itr->p_memsz,
			(uintptr_t)segment_address, (uintptr_t)(segment_address + mapped),
			prot
		);

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
static int read_and_process_manifest (
	Arena* arena,
	Stack* stack,
	Manifest* manifest,
	Footer*	footer
) {
	// Initialize envp.
	create_table(arena, &manifest->env, 4096);

	// Fill the env table.
	for (int i = 0; i < stack->envc; i++) {
		char* e = stack->envp[i];
		size_t len = strlen(stack->envp[i]);
		size_t midpoint = 0;
		for(; midpoint < len; midpoint++) {
			if (stack->envp[i][midpoint] == '=') {
				break;
			}
		}
		if (midpoint == len) {
			continue;
		}
		String key = {
			.ptr = e,
			.len = midpoint
		};
		String val = {
			.ptr = (e + midpoint + 1),
			.len = len - midpoint
		};
		insert(arena, &manifest->env, key, val);
	}

	String ld_debug = STRING_LITERAL("LD_DEBUG");
	String all = STRING_LITERAL("all");
	insert(arena, &manifest->env, ld_debug, all);

	// Read the manifest. TODO: use loadable segment?
	int fd = open("/proc/self/exe", O_RDONLY);
	off_t offset = 0;
	offset = lseek(fd, 0, SEEK_END);
	if (offset < 0) {
		ABORT("failed to seek");
	}

	// Read the manifest footer.
	if (pread64(fd, footer, sizeof(Footer), offset - sizeof(Footer)) != sizeof(Footer)) {
		ABORT("failed to read footer");
	}

	// Check the magic number.
	int matches = footer->magic[0] == 't'
		&& footer->magic[1] == 'a'
		&& footer->magic[2] == 'n'
		&& footer->magic[3] == 'g'
		&& footer->magic[4] == 'r'
		&& footer->magic[5] == 'a'
		&& footer->magic[6] == 'm'
		&& footer->magic[7] == '\0';
	if (!matches) {
		DBG("invalid magic number: %s", footer->magic);
		close(fd);
		return 0;
	}

	// Read the manifest data.
	char* data = (char*)alloc(arena, footer->size, 1);
	size_t count = 0;
	offset -= (sizeof(Footer) + footer->size);
	if (footer->version == 0) {
		offset += 8;
	}
	while (count < footer->size) {
		long amt = pread64(fd, (void*)(data + count), footer->size - count, offset);
		if (amt < 0) {
			ABORT("failed to read");
		}
		if (amt == 0) {
			break;
		}
		offset += amt;
		count += amt;
	}

	// Close the file.
	close(fd);

	// Parse the manifest.
	parse_manifest(arena, manifest, (uint8_t*)data, footer->size);

	return 1;
}

int read_footer(Footer* footer) {
	int fd = open("/proc/self/exe", O_RDONLY);
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

// Main entrypoint.
void _stub_start (void *sp) {
	// State.
	Arena arena;
	Footer footer;
	Stack stack;

	// Initialize the arena.
	create_arena(&arena);

	// Set the stack pointer.
	stack.sp = sp;

	// Scan the stack to collect argv/envp/auxiv.
	scan_stack(&stack);

	// We need to search the aux vector for the program header table and index of the entry point.
	Elf64_Phdr* phdr    = (Elf64_Phdr*)stack.auxv_glob[AT_PHDR];
	uint64_t    ph_num  = (uint64_t)stack.auxv_glob[AT_PHNUM];
	uint64_t    page_sz = (uint64_t)stack.auxv_glob[AT_PAGESZ];

	// Search for the positions of AT_ENTRY, AT_BASE, AT_PHDR, AT_PHNUM
	int nentry = -1;
	int nbase = -1;
	int nphdr = -1;
	int nnum = -1;
	for (int i = 0; i < stack.auxc; i++) {
		if (nentry >= 0 && nbase >= 0) {
			break;
		}
		switch(stack.auxv[i].a_type) {
			case AT_PHDR: {
				if (nphdr >= 0) ABORT("duplicate PT_PHDR");
				nphdr = i;
				break;
			}
			case AT_PHNUM: {
				if (nnum >= 0) ABORT("duplicate PT_PHNUM");
				nnum = i;
				break;
			}
			case AT_ENTRY: {
				if (nentry >= 0) ABORT("duplicate entrypoints");
				nentry = i;
				break;
			}
			case AT_BASE: {
				if (nbase >= 0) ABORT("duplicate base");
				nbase = i;
				break;
			}
			default: break;
		}
	}
	page_sz = page_sz ? page_sz : 4096;

	// Sanity check.
	ABORT_IF((!phdr && !ph_num) || nentry < 0, "invalid wrapped executable");

	// Compute the base address.
	void* base_address = (void*)(((uintptr_t)phdr) - (uintptr_t)phdr->p_vaddr);

	// Process the manifest.
	Manifest* manifest = ALLOC(&arena, Manifest);
	if (!read_and_process_manifest(&arena, &stack, manifest, &footer)) {
		ABORT("failed to parse manifest");
	}

	// If "--tangram-print-manifest" was passed to the stub, dump the manifest and exit.
	String arg = STRING_LITERAL("--tangram-print-manifest");
	for (int i = 1; i < stack.argc; i++) {
		if (cstreq(arg, stack.argv[i])) {
			print_manifest(manifest);
			exit(0);
		}
	}

	// Set the entrypoint. TODO: use manifest.
	if (manifest->entrypoint) {
		stack.auxv[nentry].a_un.a_val = (uintptr_t)base_address + manifest->entrypoint;
	} else if (footer.version == 1) {
		// TODO: remove this.
		stack.auxv[nentry].a_un.a_val = (uintptr_t)base_address + footer.entry;
	} else if (manifest->executable.ptr) {
		execve(manifest->executable.ptr, stack.argv, stack.envp);
	} else {
		ABORT("missing entrypoint");
	}

	// Fix program headers.
	Arena preserved_memory;
	create_arena(&preserved_memory);
	ProgramHeaders new_phdrs = create_program_headers(
		&preserved_memory,
		manifest,
		base_address,
		stack.auxv[nentry].a_un.a_val,
		phdr,
		ph_num
	);
	stack.auxv[nphdr].a_un.a_val = (uintptr_t)new_phdrs.new;
	stack.auxv[nnum].a_un.a_val = (uintptr_t)new_phdrs.num;

	// Get the entrypoint.
	void* entrypoint = (void*)stack.auxv[nentry].a_un.a_val;

	// Load the interpreter if required.
	if (manifest && manifest->interpreter.ptr) {
		// Load the interpreter. We use a separate arena to avoid use-after-free issues.
		LoadedInterpreter loaded = load_interpreter(&arena, manifest->interpreter.ptr, page_sz);
		if (nbase >= 0) {
			stack.auxv[nbase].a_un.a_val = loaded.base_address;
		}

		// Set the entrypoint as the interpreter.
		entrypoint = (void*)(loaded.base_address + loaded.entry);
	}

	// Get the entrypiont.
	if (!entrypoint) {
		ABORT("missing entrypoint");
	}

	// Prepare a new stack.
	sp = prepare_stack(&arena, &stack, manifest);

	// Cleanup all the memory we allocatd.
	destroy_arena(&arena);

	// Jump to the new entrypoint!
	DBG("jumping to entrypoint %p", entrypoint);
	transfer_control(sp, entrypoint);
}
