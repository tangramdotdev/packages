#!/bin/sh
echo  "Invocation: $@" >&2
if ! mkdir -p "$TANGRAM_OUTPUT" ; then
    echo "Failed to create output directory." >&2
    exit 84
fi
if ! $@ -o "$TANGRAM_OUTPUT/output" 1> "$TANGRAM_OUTPUT/stdout" 2> "$TANGRAM_OUTPUT/stderr" ; then
    echo "C compilation failed."  >&2
    cat "$TANGRAM_OUTPUT/stderr"          >&2
    exit 84
fi
