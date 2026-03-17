#if !defined(__APPLE__)
#error This library can only be built for macOS.
#endif

#include <mach-o/dyld.h>
#include <stdio.h>
#include "injection.h"

__attribute__((constructor)) 
static void tangram_injection() {
  restore_environment();
}

#define DYLD_INTERPOSE(_replacement, _replacee)                                \
  __attribute__((used)) static struct {                                        \
    const void *replacement;                                                   \
    const void *replacee;                                                      \
  } _interpose_##_replacee __attribute__((section("__DATA,__interpose"))) = {  \
      (const void *)(unsigned long)&_replacement,                              \
      (const void *)(unsigned long)&_replacee};

static char *IDENTITY_PATH = NULL;

// Override `NSGetExecutablePath`. See
//
// <https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man3/dyld.3.html>.
int32_t _NSGetExecutablePath_New(char *buf, uint32_t *bufsize) {
  bool tracing_enabled = getenv("TG_PRELOAD_TRACING") != NULL;
  if (IDENTITY_PATH == NULL) {
    char *value = getenv("TANGRAM_INJECTION_IDENTITY_PATH");
    if (value != NULL) {
      TRACE("TANGRAM_INJECTION_IDENTITY_PATH=%s\n", value);
      IDENTITY_PATH = (char *)malloc(strlen(value) + 1);
      strcpy(IDENTITY_PATH, value);
      unsetenv("TANGRAM_INJECTION_IDENTITY_PATH");
    } else {
      TRACE("TANGRAM_INJECTION_IDENTITY_PATH not available, expected wrapper to set.");
      return -1;
    }
  }
  TRACE("identity_path=%s", IDENTITY_PATH);
  // Note: MAXPATHLEN in bytes is 255 UTF-8 characters plus the null terminator.
  uint32_t size = strnlen(IDENTITY_PATH, 255 * 4) + 1;
  if (*bufsize < size) {
    *bufsize = size;
    return -1;
  }
  memcpy(buf, IDENTITY_PATH, size);
  return 0;
}

DYLD_INTERPOSE(_NSGetExecutablePath_New, _NSGetExecutablePath)
