.section .text.start,"ax",@progbits
.global _start
.type _start, @function
_start:
    mov x8, 93
    mov x0, 42
    svc #0
    ret
