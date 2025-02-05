#include "lib.h"
#include <stdio.h>

static char buffer[256];

const char *external_function(int arg) {
  snprintf(buffer, sizeof(buffer), "You passed the number: %d", arg);
  return buffer;
}
