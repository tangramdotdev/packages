#pragma once
#include <stddef.h>

__attribute__((naked)) 
static void jump_to_entrypoint (void* stack, void* entrypoint) {
	asm volatile (
		"mov %rdi, %rsp;"	// set the stack pointer.
		"xor %rax, %rax;"	// clear the return value.
		"xor %rbp, %rbp;"	// clear the frame pointer.
		"mov $0, %rdx;" 	// clear rdx because we have no cleanup code.
		"jmp *%rsi;"		// jump to the entrypoint.
	);
	__builtin_unreachable();
}
