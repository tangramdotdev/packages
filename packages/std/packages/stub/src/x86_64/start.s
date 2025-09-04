# This defines the entrypoint of the stub itself.
.section .text.start,"ax",@progbits
.global _start
.type _start, @function
_start:
	# Clear the base pointer.
	xor		%rbp, %rbp

	# _stub_start(%rsp)
	mov		%rsp, %rdi
	call	_stub_start

