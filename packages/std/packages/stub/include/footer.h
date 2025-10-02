#pragma once
#include <stdint.h>

typedef struct {
	uint64_t size;
	uint64_t version;
	char	 magic[8];
} Footer;
