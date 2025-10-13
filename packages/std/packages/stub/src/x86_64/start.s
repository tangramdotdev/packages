.section .text.start,"ax",@progbits
.global _start
.type _start, @function
_start:
	xor		%rbp, %rbp
	mov		%rsp, %rdi
	call	main
