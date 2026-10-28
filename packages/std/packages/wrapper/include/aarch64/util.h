#pragma once

__attribute__((noreturn))
static void jump_to_entrypoint (void* stack, void* entrypoint, void* finalizer) {
	register long x0 asm("x0") = (long)stack;
	register long x1 asm("x1") = (long)entrypoint;
	register long x2 asm("x2") = (long)finalizer;
	asm volatile (
		"mov sp, x0;"		// set the stack pointer.
		"mov x29, xzr;"		// clear the frame pointer.
		"mov x0, x2;"		// set the atexit pointer.
		"br x1;"		// jump to the entrypoint
		:
		: "r"(x0), "r"(x1), "r"(x2)
		: "memory", "cc"
	);
	__builtin_unreachable();
}
