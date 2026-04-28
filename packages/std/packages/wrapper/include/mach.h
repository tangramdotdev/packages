#pragma once
#include <stdint.h>
#define LC_CODE_SIGNATURE 29
typedef int cpu_type_t;
typedef int cpu_subtype_t;

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
	uint32_t 	dataoff;
	uint32_t 	datasize;
} linkedit_data_command;
