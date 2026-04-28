#pragma once

static void jump_to_entrypoint (void* stack, void* entrypoint) {
	register long x0 asm("x0") = (long)stack;
	register long x1 asm("x1") = (long)entrypoint;
	asm volatile (
		"mov sp, x0;"		// set the stack pointer.
		"mov x29, xzr;"		// clear the frame pointer.
		"mov x0, xzr;"		// clear atexit pointer
		"br x1;"		// jump to the entrypoint
		:
		: "r"(x0), "r"(x1)
		: "memory", "cc"
	);
	__builtin_unreachable();
}
