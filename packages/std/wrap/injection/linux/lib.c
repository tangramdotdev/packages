#define _GNU_SOURCE
#include "injection.h"

__attribute__((constructor))
static void tangram_injection() {
  restore_environment();
}
