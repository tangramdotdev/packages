.section .text.start,"ax",@progbits
.global _start
.type _start, @function
_start:
	mov x29, xzr
	mov x0, sp
	bl  main
