#!/bin/sh
echo  "Invocation: $@" >&2
if ! mkdir -p "$OUTPUT" ; then 
    echo "Failed to create output directory." >&2
    exit 84
fi
if ! $@ -o "$OUTPUT/output" 1> "$OUTPUT/stdout" 2> "$OUTPUT/stderr" ; then 
    echo "C compilation failed."  >&2
    cat "$OUTPUT/stderr"          >&2
    exit 84
fi
