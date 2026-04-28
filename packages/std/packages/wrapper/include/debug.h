// Debug helpers.
#pragma once
#ifdef __linux__
#include <elf.h>
#endif

#include "common.h"
#include "syscall.h"

#ifdef __aarch64__
#include "aarch64/debug.h"
#endif

#ifdef __x86_64__
#include "x86_64/debug.h"
#endif

TG_VISIBILITY void __putc (int ch, void* data);

#define NANOPRINTF_IMPLEMENTATION
#ifdef TG_VISIBILITY_STATIC
#define NANOPRINTF_VISIBILITY_STATIC
#endif
#include "nanoprintf.h"
#undef NANOPRINTF_IMPLEMENTATION

#ifdef DEBUG
	#define DBG(...) do { trace(__VA_ARGS__); trace("\n"); } while (0)
#else
	#define DBG(...)
#endif

#ifdef TG_USE_SYSCALLS
#define ABORT(...)			\
	do {				\
		trace(__VA_ARGS__);	\
		trace("\n");		\
		BREAK;			\
		exit(111);		\
	} while (0)
#else
#include <errno.h>
#include <string.h>
#define ABORT(...)					\
	do {						\
		trace(__VA_ARGS__);			\
		if (errno != 0)				\
		{ trace(": %s", strerror(errno)); } 	\
		trace("\n");				\
		exit(111);				\
	} while (0)
#endif

#define ABORT_IF(cond, ...) if (cond) { ABORT(__VA_ARGS__); }

TG_VISIBILITY void trace (const char* format, ...);
TG_VISIBILITY const char* auxv_type_string (uint64_t a_type);
TG_VISIBILITY const char* p_type_string (uint64_t p_type);

#ifdef TG_IMPLEMENTATION
TG_VISIBILITY void trace (const char* format, ...) {
	va_list args;
	va_start(args, format);
	npf_vpprintf(__putc, NULL, format, args);
	va_end(args);
}

// Convert auxv type to a string.
#ifdef __linux__
TG_VISIBILITY const char* auxv_type_string (uint64_t a_type) {
	switch (a_type) {
		case AT_NULL: 		return "AT_NULL";
		case AT_IGNORE: 	return "AT_IGNORE";
		case AT_EXECFD: 	return "AT_EXECFD";
		case AT_PHDR: 		return "AT_PHDR";
		case AT_PHENT: 		return "AT_PHENT";
		case AT_PHNUM: 		return "AT_PHNUM";
		case AT_PAGESZ: 	return "AT_PAGESZ";
		case AT_BASE: 		return "AT_BASE";
		case AT_FLAGS: 		return "AT_FLAGS";
		case AT_ENTRY: 		return "AT_ENTRY";
		case AT_NOTELF: 	return "AT_NOTELF";
		case AT_UID: 		return "AT_UID";
		case AT_EUID: 		return "AT_EUID";
		case AT_GID: 		return "AT_GID";
		case AT_EGID: 		return "AT_EGID";
		case AT_CLKTCK: 	return "AT_CLKTCK";
		case AT_EXECFN: 	return "AT_EXECFN";
		case AT_PLATFORM: 	return "AT_PLATFORM";
		case AT_HWCAP2: 	return "AT_HWCAP2";
		case AT_HWCAP: 		return "AT_HWCAP";
		case AT_FPUCW: 		return "AT_FPUCW";
		case AT_DCACHEBSIZE: 	return "AT_DCACHEBSIZE";
		case AT_ICACHEBSIZE: 	return "AT_ICACHEBSIZE";
		case AT_UCACHEBSIZE: 	return "AT_UCACHEBSIZE";
		case AT_SYSINFO: 	return "AT_SYSINFO";
		case AT_SYSINFO_EHDR: 	return "AT_SYSINFO_EHDR";
		case AT_MINSIGSTKSZ: 	return "AT_MINSIGSTKSZ";
		case AT_SECURE: 	return "AT_SECURE";
		case AT_RANDOM: 	return "AT_RANDOM";
		case 27: 		return "AT_RSEQ_FEATURE_SIZE";
		case 28: 		return "AT_RSEQ_ALIGN";
		default: 		return "UNKNOWN";
	}
}

TG_VISIBILITY const char* p_type_string (uint64_t p_type) {
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
#endif

TG_VISIBILITY void __putc (int ch, void* data) {
	uint8_t buf = (uint8_t)ch;
	write(STDERR_FILENO, (void*)&buf, 1);
}

#endif