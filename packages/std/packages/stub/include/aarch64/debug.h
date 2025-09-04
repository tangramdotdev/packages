#pragma once
#ifdef BREAKPOINTS
	#define BREAK do { asm volatile ("brk #0"); } while (0)
#else
	#define BREAK
#endif
