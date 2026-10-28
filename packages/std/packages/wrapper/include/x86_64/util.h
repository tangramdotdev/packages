#pragma once
#include <stddef.h>

__attribute__((naked, noreturn))
static void jump_to_entrypoint (void* stack, void* entrypoint, void* finalizer) {
	asm volatile (
		"mov %rdi, %rsp;"	// set the stack pointer.
		"xor %rax, %rax;"	// clear the return value.
		"xor %rbp, %rbp;"	// clear the frame pointer.
		"jmp *%rsi;"		// jump to the entrypoint, leaving the atexit pointer in rdx.
	);
}
