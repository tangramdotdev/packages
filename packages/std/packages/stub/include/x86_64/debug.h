#pragma once
#ifdef SOFTWARE_BREAKPOINTS
	#define BREAK do { asm volatile ("int3"); } while (0)
#else
	#define BREAK
#endif
