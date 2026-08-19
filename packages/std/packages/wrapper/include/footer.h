#pragma once
#include <stdint.h>
#define TANGRAM_MAGIC "tangram"
typedef struct {
	uint64_t size;
	uint64_t version;
	char	 magic[8];
} Footer;
