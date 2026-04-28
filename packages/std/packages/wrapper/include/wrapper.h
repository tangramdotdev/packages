#pragma once
#include "common.h"
#include "arena.h"
#include "debug.h"
#include "json.h"
#include "manifest.h"
#include "syscall.h"
#include "table.h"
#include "util.h"
#ifdef __linux__
#include <elf.h>
#elif defined(__APPLE__)
#include "mach.h"
#endif

// Data passed to us on the stack by the kernel, as well as some counters.
typedef struct
{
	void*		sp;	// the stack pointer at the entrypoint.
	int 		argc;	// num args
	char**		argv;	// arg vector
	int 		envc;	// num env vars
	char**		envp;	// env vector
	int 		auxc;	// num aux vals
#ifdef __linux__
	Elf64_auxv_t*	auxv;	// the aux vector
	uintptr_t	auxv_glob[32];	// sorted aux vector, for quick lookup later.
#endif
} Stack;

// Options configured with CLI args or environment variables.
typedef struct
{
	bool enable_tracing;	// TANGRAM_TRACING=1
	bool suppress_args;	// --tangram-suppress-args, TANGRAM_SUPPRESS_ARGS=1
	bool suppress_env;	// --tangram-suppress-env, TANGRAM_SUPPRESS_ENV=1
	bool print_manifest;	// --tangram-print-manifest
} Options;

// The executable image.
typedef struct {
#ifdef __linux__
	Elf64_Ehdr* 	elf_header;		// Header of the ELF file.
	Elf64_Phdr* 	program_headers;	// Program headers passed by the kernel.
	Elf64_Shdr* 	section_headers;	// Section headers read from the binary.
	char*		section_string_table;	// String table, for finding sections by name
#endif
	Manifest* 	manifest;		// The parsed manifest.
	Footer		footer;			// The parsed footer.
} Executable;

// Linux implementation details.
#ifdef __linux__
typedef struct {
	uintptr_t phdr;		// address of the loader's program headers
	uintptr_t phnum;	// number of program headers
	uintptr_t entry;	// address of the loader's entrypoint
	uintptr_t base_address; // base address of the loader
} Interpreter;

typedef struct {
	Elf64_Phdr*	new;	// The new program headers.
	uint64_t	num;	// Number of headers.
} ProgramHeaders;

// Create the argc/envp/auxv from the stack pointer passed by the kernel.
TG_VISIBILITY Stack create_stack (void* sp);

// Create the interpreter state for userland exec (linux only)
TG_VISIBILITY Interpreter create_interpreter (
	Arena* arena,
	const char* path,
	uint64_t page_sz,
	Options* options
);

// Copy and patch program headers (ELF only)
TG_VISIBILITY ProgramHeaders create_program_headers (
	Arena* arena,
	Manifest* manifest,
	void* base_address,
	uintptr_t original_entrypiont,
	Elf64_Phdr* old,
	size_t num
);

// Allocate and setup the new executable stack before jumping to the new entrypoint.
TG_VISIBILITY void* prepare_executable_stack (Arena* arena, Stack* stack, Manifest* manifest, Options* options);
#endif

#ifdef __APPLE__
// Create the argc/envp from the args passed to the CLI and environ pointer.
TG_VISIBILITY Stack create_stack (int argc, char** argv);
#endif

// Parse CLI options/env.
TG_VISIBILITY Options create_options (Stack*);

// Parse the manifest and setup the executable before execution.
TG_VISIBILITY Executable create_executable (Arena* arena, Stack* stack, Options* options);

// Exec (non userland)
TG_VISIBILITY void exec (Arena* arena, Manifest* manifest, char* argv0, Options* options);

TG_VISIBILITY void print_stack (Stack* stack);

#ifdef TG_IMPLEMENTATION
#ifdef __linux__
// Raw entrypoint.
// The custom .section is just used to make the linker script a little easier. We drop _start at a
// known address so that it's easier to wrap binaries without having to look it up in when patching.
__asm__ (
	".section .text.start,\"ax\",@progbits\n"
	".global _start\n"
	".type _start, @function\n"
	"_start:\n"
#ifdef __aarch64__
	"mov  x29, xzr\n"	// clear frame pointer
	"mov  x0, sp\n"		// main(sp)
	"bl   main\n"
#elif defined(__x86_64__)
	"xor  %rbp, %rbp\n"	// clear frame pointer
	"mov  %rsp, %rdi\n"	// main(%rsp)
	"call main\n"
#else
#error "unsupported architecture"
#endif
);
int main (void* sp) {
	Stack stack = create_stack(sp);
#else
int main (int argc, char** argv) {
	Stack stack = create_stack(argc, argv);
#endif
	Options options = create_options(&stack);
	if (options.enable_tracing) {
		trace(
			"options: enable_tracing:%d, suppress_args:%d, suppress_env:%d print_manifest:%d\n",
			options.enable_tracing, options.suppress_args, options.suppress_env, options.print_manifest
		);
		trace("original stack:\n");
		print_stack(&stack);
	}

	// We only grab the page size from the aux vector, we'll read the program headers later.
	uint64_t page_sz = 0;
	#ifdef __linux__
	page_sz = (uint64_t)stack.auxv_glob[AT_PAGESZ];
	#endif
	page_sz = page_sz ? page_sz : 4096;

	// Initialize the arena.
	Arena arena;
	create_arena(&arena, page_sz);
	if (options.enable_tracing) {
		trace("initialized arena\n");
	}

	// Create the new executable image.
	Executable executable = create_executable(&arena, &stack, &options);
	if (options.enable_tracing) {
		trace("created executable\n");
	}
	if (options.print_manifest) {
		print_manifest(executable.manifest);
		exit(0);
	}

	// If the executable is a string, fallback on execve.
	if (executable.manifest->executable.ptr) {
		exec(&arena, executable.manifest, stack.argv[0], &options);
	}

#ifdef __linux__
	ABORT_IF(!executable.manifest->entrypoint, "missing entrypoint");
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
	if (options.enable_tracing) {
		trace("read aux vector\n");
	}

	// Compute the base address. Normally this is computed using the program header table
	// supplied in the aux vector, but this could be garbage if using a patched program header table.
	uintptr_t load_address = stack.auxv_glob[AT_ENTRY] - executable.elf_header->e_entry;

	// Check that we have space to write the new program header table and number of entries later.
	ABORT_IF(!nphdr || nentry < 0, "missing AT_PHDR or AT_ENTRY");

	// Get the entrypoint.
	void* entrypoint = NULL;
	if (executable.manifest->interpreter.ptr) {
		// If there's an interpreter arg,
		stack.auxv[nentry].a_un.a_val = load_address + executable.manifest->entrypoint;

		// Load the interpreter.
		Interpreter interpreter = create_interpreter(
			&arena,
			(char*)executable.manifest->interpreter.ptr,
			page_sz,
			&options
		);
		if (options.enable_tracing) {
			trace("created interpreter\n");
		}

		// Update the AT_BASE entry of the aux vector.
		if (nbase >= 0) {
			stack.auxv[nbase].a_un.a_val = interpreter.base_address;
		}

		// Set the entrypoint as the interpreter.
		entrypoint = (void*)(interpreter.base_address + interpreter.entry);
	} else {
		entrypoint = (void*)((uintptr_t)load_address + executable.manifest->entrypoint);
	}

	// Fix program headers. We use a second arena to avoid freeing the memory before userland exec.
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
	if (options.enable_tracing) {
		trace("created program headers\n");
	}

	// Prepare a new stack.
	sp = prepare_executable_stack(&arena, &stack, executable.manifest, &options);
	if (options.enable_tracing) {
		Stack dbg_stack = create_stack(sp);
		trace("new stack:\n");
		print_stack(&dbg_stack);
	}

	// Cleanup all the memory we allocated.
	destroy_arena(&arena);
	if (options.enable_tracing) {
		trace("destroyed memory\n");
	}

	// Jump to the new entrypoint.
	if (options.enable_tracing) {
		trace("entrypoint: 0x%lx\n", (uintptr_t)entrypoint);
	}
	jump_to_entrypoint(sp, entrypoint);
#else
	ABORT("unsupported target");
#endif
}

#ifdef __linux__
TG_VISIBILITY Stack create_stack (void* sp) {
	Stack stack = { .sp = sp };
	ABORT_IF((uintptr_t)stack.sp % 16 != 0, "misaligned stack");

	// The bottom of the stack is the arg vector.
	stack.argc = (int)*(uint64_t *)stack.sp;
	stack.argv = (char**)((int64_t *)stack.sp + 1);

	// Past the arg vector is the env pointer, make sure to count the number of env vars.
	stack.envp = (char**)((int64_t *)stack.sp + 1 + stack.argc + 1);
	stack.envc = 0;
	for (; stack.envp[stack.envc]; stack.envc++){}

	// Past the env pointer is the aux vector.
	stack.auxv = (Elf64_auxv_t *)((int64_t *)stack.sp + 1 + stack.argc + 1 + stack.envc + 1);
	stack.auxc = 0;
	for(;;) {
		Elf64_auxv_t* v = stack.auxv + stack.auxc;
		stack.auxc++;
		if (v->a_type < 32) {
			stack.auxv_glob[v->a_type] = (uintptr_t)v->a_un.a_val;
		}
		if (v->a_type == AT_NULL) {
			break;
		}
	}
	return stack;
}
#else
extern char** environ;
TG_VISIBILITY Stack create_stack (int argc, char** argv) {
	Stack stack = { 0 };

	// The bottom of the stack is the arg vector.
	stack.argc = argc;
	stack.argv = argv;

	// Past the arg vector is the env pointer, make sure to count the number of env vars.
	stack.envp = environ;
	stack.envc = 0;
	for (; stack.envp[stack.envc]; stack.envc++){}

	return stack;
}
#endif

TG_VISIBILITY Options create_options (Stack* stack) {
	char **itr, **end;
	String TANGRAM_SUPPRESS_ARGS = STRING_LITERAL("TANGRAM_SUPPRESS_ARGS");
	String TANGRAM_SUPPRESS_ENV  = STRING_LITERAL("TANGRAM_SUPPRESS_ENV");
	String TANGRAM_TRACING	     = STRING_LITERAL("TANGRAM_TRACING");
	Options options = {
		.enable_tracing = false,
		.suppress_args = false,
		.suppress_env = false,
	};

	itr = stack->argv;
	end = itr + stack->argc;
	for(; itr != end; itr++) {
		String arg = STRING_LITERAL(*itr);
		options.suppress_args  |= cstreq(arg, "--tangram-suppress-args");
		options.suppress_env   |= cstreq(arg, "--tangram-suppress-env");
		options.print_manifest |= cstreq(arg, "--tangram-print-manifest");
	}

	itr = stack->envp;
	end = itr + stack->envc;
	for(; itr != end; itr++) {
		String env = STRING_LITERAL(*itr);
		String key = STRING_LITERAL("TANGRAM_TRACING=");
		String argv0 = STRING_LITERAL(stack->argv[0]);
		if (starts_with(env, STRING_LITERAL("TANGRAM_TRACING="))) {
			String val = { .ptr = env.ptr + key.len, .len = env.len - key.len };
			options.enable_tracing |= cstreq(val, "true") || streq(val, argv0);
		}
		options.suppress_args  |= starts_with(env, TANGRAM_SUPPRESS_ARGS);
		options.suppress_env   |= starts_with(env, TANGRAM_SUPPRESS_ENV);
	}

	return options;
}

TG_VISIBILITY Executable create_executable (Arena* arena, Stack* stack, Options* options) {
	// Get the executable path.
	String path = executable_path(arena);

	// Initialize the executable.
	Executable executable	= {0};
	executable.manifest	= ALLOC(arena, Manifest);
	create_table(arena, &executable.manifest->env, 4096);
	if (options->enable_tracing) {
		trace("created env\n");
	}

	// Fill the env table.
	if (!options->suppress_env) {
		char** itr = (char**)stack->envp;
		char** end = itr + stack->envc;
		for (; itr != end; itr++) {
			char* e = *itr;

			// Find the length and midpoint of the env var.
			size_t n = 0;
			size_t m = 0;
			for (; e[n]; n++) {
				if (e[n] == '=' && m == 0) {
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

			insert(arena, &executable.manifest->env, key, val);
		}
		if (options->enable_tracing) {
			trace("initialized env\n");
		}
	}

	// Look for the manifest in the executable sections.
	char* data = NULL;

	// Read the manifest. TODO: use loadable segment?
	int fd = open((char*)path.ptr, O_RDONLY, 0);
	ABORT_IF(fd < 0, "failed to open the file %s", path.ptr);
	off_t offset = 0;
	if (options->enable_tracing) {
		trace("opened %s (%d)\n", path.ptr, fd);
	}
#ifdef __linux__
	// On ELF targets, the manifest is embedded in an ELF section. To read it we read the ELF
	// file, walk the file contents, and read the manifest directly from the section. In the
	// future we may choose to make the section loadable and read only to avoid needing to open
	// the file at all.
	executable.elf_header = ALLOC(arena, Elf64_Ehdr);

	// Read the elf header. We don't need to do any validation here, we assume the kernel didn't lie.
	read_all(options->enable_tracing, fd, (char*)executable.elf_header, sizeof(Elf64_Ehdr), 0);

	// Read the program header table.
	offset = executable.elf_header->e_phoff;
	size_t size = executable.elf_header->e_phnum * sizeof(Elf64_Phdr);
	executable.program_headers = ALLOC_N(arena, executable.elf_header->e_phnum, Elf64_Phdr);
	read_all(options->enable_tracing, fd, (char*)executable.program_headers, size, offset);

	// Read the section header table.
	offset = executable.elf_header->e_shoff;
	size = executable.elf_header->e_shnum * sizeof(Elf64_Shdr);
	executable.section_headers = ALLOC_N(arena, executable.elf_header->e_shnum, Elf64_Shdr);
	read_all(options->enable_tracing, fd, (char*)executable.section_headers, size, offset);

	// Read the section header string table.
	Elf64_Shdr* section = executable.section_headers + executable.elf_header->e_shstrndx;
	offset = section->sh_offset;
	size = section->sh_size;
	executable.section_string_table = ALLOC_N(arena, size, char);
	read_all(options->enable_tracing, fd, (char*)executable.section_string_table, size, offset);

	// Get the file size.
	offset = lseek(fd, 0, SEEK_END);
	if (offset < 0) {
		ABORT("failed to seek");
	}
	if (options->enable_tracing) {
		trace("file size: %d\n", offset);
	}

	Elf64_Shdr* section_itr = executable.section_headers;
	Elf64_Shdr* section_end = section_itr + executable.elf_header->e_shnum;
	String TANGRAM_MANIFEST_SECTION_NAME = STRING_LITERAL(".note.tg-manifest");
	for (; section_itr != section_end; section_itr++) {
		String name = {0};
		name.ptr = (uint8_t*)&executable.section_string_table[section_itr->sh_name];
		name.len = tg_strlen((char*)name.ptr);
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
			memcpy((void*)&executable.footer, (void*)(data + (size - sizeof(Footer))), sizeof(Footer));
			break;
		}
	}
	ABORT_IF(!data, "failed to find manifest section");

#elif defined(__APPLE__)
	// On Mach platforms, the manifest is embedded into the binary just before the code signature
	// which must occur at the end of the file. We read the header and all the load commands to
	// find where the code signature is in the file, then walk back from there to read the
	// manifest.
	mach_header_64 mach_header = {0};
	load_command load_command = {0};
	linkedit_data_command code_signature_command = {0};
	read_all(options->enable_tracing, fd, (char*)&mach_header, sizeof(mach_header_64), 0);
	if(options->enable_tracing) {
		trace("mach_header: %08x, ncmds: %d, izeofcmds: %d\n",
			mach_header.magic, mach_header.ncmds, mach_header.sizeofcmds);
	}

	// Find the code signature.
	offset = (off_t)sizeof(mach_header_64);
	for (int i = 0; i < mach_header.ncmds; i++) {
		read_all(options->enable_tracing, fd, (char*)&load_command, sizeof(load_command), offset);
		if (load_command.cmd == LC_CODE_SIGNATURE) {
			read_all(options->enable_tracing, fd, (char*)&code_signature_command, sizeof(linkedit_data_command), offset);
			break;
		}
		offset += load_command.cmdsize;
	}
	ABORT_IF(code_signature_command.dataoff== 0, "failed to find the code signature");

	// The footer will be stored just before the code signature.
	offset = code_signature_command.dataoff - (off_t)sizeof(Footer);
	read_all(options->enable_tracing, fd, (char*)&executable.footer, sizeof(Footer), offset);

	// The manifest is just before the footer.
	offset -= (off_t)executable.footer.size;
	data = ALLOC_N(arena, executable.footer.size, char);
	read_all(options->enable_tracing, fd, data, executable.footer.size, offset);
#else
#error "unsupported target"
#endif
	// Close the file.
	close(fd);

	// Parse the manifest.
	if (options->enable_tracing) {
		char* manifest_string = ALLOC_N(arena, executable.footer.size + 1, char);
		memcpy(manifest_string, data, executable.footer.size);
		trace("%s\n", manifest_string);
	}
	parse_manifest(arena, executable.manifest, options->enable_tracing, (uint8_t*)data, executable.footer.size);
	
	// Combine manifest paths with existing LD_LIBRARY_PATH/LD_PRELOAD.
	String original_ld_library_path = lookup(&executable.manifest->env, STRING_LITERAL(LD_LIBRARY_PATH));
	if (executable.manifest->ld_library_path.len > 0 && original_ld_library_path.ptr) {
		String ss[2] = { executable.manifest->ld_library_path , original_ld_library_path };
		executable.manifest->ld_library_path = join(arena, STRING_LITERAL(":"), ss, 2);
	} else if (executable.manifest->ld_library_path.len == 0) {
		executable.manifest->ld_library_path = original_ld_library_path;
	}
	String original_ld_preload = lookup(&executable.manifest->env, STRING_LITERAL(LD_PRELOAD));
	if (executable.manifest->ld_preload.len > 0 && original_ld_preload.ptr) {
		String ss[2] = { executable.manifest->ld_preload, original_ld_preload };
		executable.manifest->ld_preload = join(arena, STRING_LITERAL(":"), ss, 2);
	} else if (executable.manifest->ld_preload.len == 0) {
		executable.manifest->ld_preload = original_ld_preload;
	}
	// Setup the preloads/library paths.
#ifdef __linux__
	bool restore_env_vars = !executable.manifest->executable.ptr;
#else
	bool restore_env_vars = true;
#endif
	if (restore_env_vars) {
		if (executable.manifest->ld_library_path.len > 0) {
			String key = STRING_LITERAL(LD_LIBRARY_PATH);
			insert(arena, &executable.manifest->env, key, executable.manifest->ld_library_path);
			if (original_ld_library_path.ptr) {
				String restore = STRING_LITERAL("TANGRAM_INJECTION_LIBRARY_PATH");
				insert(arena, &executable.manifest->env, restore, original_ld_library_path);
			} else {
				String key = STRING_LITERAL("TANGRAM_INJECTION_CLEAR_LIBRARY_PATH");
				String value = STRING_LITERAL("true");
				insert(arena, &executable.manifest->env, key, value);
			}
			if (options->enable_tracing) {
				trace("set LD_LIBRARY_PATH for userland exec\n");
			}
		}
		if (executable.manifest->ld_preload.len > 0) {
			String key = STRING_LITERAL(LD_PRELOAD);
			insert(arena, &executable.manifest->env, key, executable.manifest->ld_preload);
			if (original_ld_preload.ptr) {
				String restore = STRING_LITERAL("TANGRAM_INJECTION_PRELOAD");
				insert(arena, &executable.manifest->env, restore, original_ld_preload);
			} else {
				String key = STRING_LITERAL("TANGRAM_INJECTION_CLEAR_PRELOAD");
				String value = STRING_LITERAL("true");
				insert(arena, &executable.manifest->env, key, value);
			}
			if (options->enable_tracing) {
				trace("set LD_PRELOAD for userland exec\n");
			}
		}
	}

	// Set TANGRAM_INJECTION_IDENTITY_PATH.
	if (executable.manifest->interpreter_kind == INTERPRETER_KIND_LD_LINUX
	|| executable.manifest->interpreter_kind == INTERPRETER_KIND_LD_MUSL
	|| executable.manifest->interpreter_kind == INTERPRETER_KIND_DYLD) {
		String identity_path = STRING_LITERAL("TANGRAM_INJECTION_IDENTITY_PATH");
		insert(arena, &executable.manifest->env, identity_path, path);
		if (options->enable_tracing) {
			trace("inserted %s\n", identity_path.ptr);
		}
	}

	// Append the arg list if necessary.
	if (!options->suppress_args) {
		// Allocate a new arg vector.
		String* argv = ALLOC_N(arena, stack->argc + executable.manifest->argc, String);
		size_t argc = 0;

		// Now add the args from the manifest.
		for (size_t n = 0; n < executable.manifest->argc; n++) {
			argv[argc++] = executable.manifest->argv[n];
		}

		// Finally the stack args, not including argv0. Filter out tangram-specific flags.
		String tangram_prefix = STRING_LITERAL("--tangram-");
		for (size_t n = 1; n < stack->argc; n++) {
			String arg = { .ptr = (uint8_t*)stack->argv[n], .len = tg_strlen(stack->argv[n]) };
			if (starts_with(arg, tangram_prefix)) {
				continue;
			}
			argv[argc++] = arg;
		}

		// Update the manifest.
		executable.manifest->argv = argv;
		executable.manifest->argc = argc;
	}

	return executable;
}

#ifdef __linux__
TG_VISIBILITY Interpreter create_interpreter(
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

	// Create one big mapping for the entire interpreter with PROT_NONE permissions.
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

		// If the page is marked writeable, make sure to zero-out any excess between the
		//
		if (prot & PF_W) {
			uintptr_t offset = misalignment + itr->p_filesz;
			uintptr_t length = mapped - itr->p_filesz - misalignment;
			void* dst = (void*)((char*)segment_address + offset);
			memset(dst, 0, length);
		}

		// Sanity check our work.
		ABORT_IF(mapped < itr->p_memsz, "failed to map segment");

		if (options->enable_tracing) {
			trace("loader: %08lx..%08lx to %08lx..%08lx %03o\n",
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
	Interpreter interpreter = {
		.phdr  = phdr_addr,
		.phnum = ehdr->e_phnum,
		.entry = (uintptr_t)ehdr->e_entry,
		.base_address = (uintptr_t)bias
	};

	if (options->enable_tracing) {
		trace("loaded interpreter: phdr: %lx, phnum: %d, entry: %lx, base_address: %lx\n",
			interpreter.phdr,
			interpreter.phnum,
			interpreter.entry,
			interpreter.base_address
		);
	}

	// Close the file.
	close(fd);

	// Return the entrypoint.
	return interpreter;
}

TG_VISIBILITY ProgramHeaders create_program_headers(
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
		// If this is the load segment containing the stub, skip it.
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
#endif

TG_VISIBILITY void exec (Arena* arena, Manifest* manifest, char* argv0, Options* options) {
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
		+ 1  // --inhibit-cache
		+ 1  // --library-path
		+ 1  // library path value
		+ 1  // --preload
		+ 1  // preload value
		+ 1  // --argv0
		+ 1  // argv[0]
		+ 1  // --
		+ 1; // executable

	// Create argv, envp
	char** argv = ALLOC_N(arena, argc + 1, char*);
	char** envp = ALLOC_N(arena, manifest->env.size + 1, char*);

	// Fill argv.
	size_t n = 0;
	if (manifest->interpreter.ptr) {
		argv[n++] = pathname;
		for (int i = 0; i < manifest->interp_argc; i++) {
			argv[n++] = cstr(arena, manifest->interp_argv[i]);
		}
		if (manifest->interpreter_kind == INTERPRETER_KIND_LD_LINUX) {
			argv[n++] = "--inhibit-cache";
		}
		if (manifest->interpreter_kind == INTERPRETER_KIND_LD_MUSL
		|| manifest->interpreter_kind == INTERPRETER_KIND_LD_LINUX) {
			if (manifest->ld_library_path.ptr) {
				argv[n++] = "--library-path";
				argv[n++] = cstr(arena, manifest->ld_library_path);
			}
			if (manifest->ld_preload.ptr) {
				argv[n++] = "--preload";
				argv[n++] = cstr(arena, manifest->ld_preload);
			}
			argv[n++] = "--argv0";
			argv[n++] = argv0;
		}
		if (manifest->interpreter_kind == INTERPRETER_KIND_LD_MUSL){
			argv[n++] = "--";
		}
		argv[n++] = cstr(arena, manifest->executable);
	} else {
		argv[n++] = argv0;
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

#ifdef __linux__
static inline void push_str (void** sp, const char* str) {
	size_t len = strlen_including_nul(str);
	(*sp) -= len;
	memcpy(*sp, (const void*)str, len);
}
static inline void push_auxv (void** sp, const Elf64_auxv_t* auxv) {
	(*sp) -= sizeof(Elf64_auxv_t);
	memcpy(*sp, (const void*)auxv, sizeof(Elf64_auxv_t));
}

#define PUSH(sp, val) do { sp -= sizeof(uintptr_t); *((uintptr_t*)sp) = (uintptr_t)val; } while (0)

TG_VISIBILITY void* prepare_executable_stack (
	Arena* arena,
	Stack* stack,
	Manifest* manifest,
	Options* options
) {
	// Get the default stack size using ulimit. TODO: how does this work w/ cgroups?
	rlimit_t rlim;
	ABORT_IF(getrlimit(RLIMIT_STACK, &rlim), "failed to get the stack size");
	size_t stack_size = rlim.soft;

	// Allocate the stack. On x86_64, the stack "grows down" meaning that the address returned
	// by mmap is actually the lowest possible address for the stack. The "top" of the new stack
	// is the address of one page past it.
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

	// If there are an even number of env and arg vals then we need an additional 8 bytes of
	// padding to ensure the top of the stack is aligned.
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
#endif
TG_VISIBILITY void print_stack (Stack* stack) {
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
#ifdef __linux__
	trace("\tauxv: [\n");
	for (int n = 0; n < stack->auxc; n++) {
		trace("\t\t{ a_type: \"%s\", a_un: %08lx },\n",
			auxv_type_string(stack->auxv[n].a_type),
			stack->auxv[n].a_un.a_val
		);
	}
	trace("\t]\n}\n");
#endif
}

#endif
