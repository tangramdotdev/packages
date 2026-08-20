#pragma once
#include <stdint.h>
#define LC_SEGMENT_64 0x19
#define LC_CODE_SIGNATURE 29
typedef int cpu_type_t;
typedef int cpu_subtype_t;
typedef int vm_prot_t;

typedef struct {
	uint32_t	magic;
	cpu_type_t	cputype;
	cpu_subtype_t	cpusubtype;
	uint32_t	filetype;
	uint32_t	ncmds;
	uint32_t	sizeofcmds;
	uint32_t	flags;
	uint32_t	reserved;
} mach_header_64;

typedef struct {
	uint32_t 	cmd;
	uint32_t 	cmdsize;
} load_command;

typedef struct {
	uint32_t 	cmd;
	uint32_t 	cmdsize;
	char		segname[16];
	uint64_t	vmaddr;
	uint64_t	vmsize;
	uint64_t	fileoff;
	uint64_t	filesize;
	vm_prot_t	maxprot;
	vm_prot_t	initprot;
	uint32_t	nsects;
	uint32_t	flags;
} segment_command_64;

typedef struct {
	uint32_t 	cmd;
	uint32_t 	cmdsize;
	uint32_t 	dataoff;
	uint32_t 	datasize;
} linkedit_data_command;
