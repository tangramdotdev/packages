## Coding notes

The stub is a standalone binary blob of executable bytes. With that come some restrictions:

- All functions should be `static`, except for `_start`.
- Naming doesn't really matter, because this program will never link to anything else (statically or dynamically).
- Global variables are forbidden by construction. They will cause segfaults at runtime.
- All addresses are relative, so there is no GOT/PLT.
- No stdlib, if you need syscalls make sure they go in `syscall.h`.
