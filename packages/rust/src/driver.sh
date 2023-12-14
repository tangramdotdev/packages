#!/bin/sh -u
# Driver script for tangram_rustc.
#
# Arguments:
#   --rustc  <rustc path>
#   --source <source directory>
#   --       <rustc args>
#
# Environment variables:
#   OUTPUT: output directory for rustc.
#
while test  $# -gt 0  ; do
  case $1 in
    "--rustc")
      RUSTC="$2"
      shift
      shift
    ;;
    "--source")
      SOURCE="$2"
      shift
      shift
    ;;
    "--out-dir")
      OUT_DIR="$2"
      shift
      shift
    ;;
    "--")
      shift
      ARGS="$*"
      break;
    ;;
  esac
done

# Change to the source directory and invoke the compiler.
cd "$SOURCE" || exit 1
if ! mkdir -p "$OUTPUT/out" "$OUTPUT/build" "$OUTPUT/log" ; then
  echo "Failed to construct output directory."
  exit 1
fi

# Copy over the OUT_DIR contents and update the OUT_DIR env var.
if ! cp -a "$OUT_DIR/." "$OUTPUT/out" ; then
  echo "Failed to copy $OUT_DIR to $OUTPUT"
  exit 1
fi

# Invoke the compiler.
if ! OUT_DIR="$OUTPUT/out" "$RUSTC" $ARGS --out-dir "$OUTPUT/build" 2> "$OUTPUT/log/stderr" 1> "$OUTPUT/log/stdout" ; then
  echo "Rustc failed."
  cat "$OUTPUT/log/stderr"
  exit 1
fi