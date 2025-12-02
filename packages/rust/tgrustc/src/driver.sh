#!/bin/sh
# Driver script for tangram_rustc.
#
# Arguments:
#   --rustc  <rustc path>
#   --source <source directory>
#   --out-dir <output directory>
#   --       <rustc args>
#
# Environment variables:
#   TANGRAM_OUTPUT: output directory for rustc.
#
set -eu

log() {
	echo "$@" >&2
}

die() {
	log "$@"
	exit 1
}

# Parse arguments
shift # skip the script name
while [ $# -gt 0 ]; do
	case $1 in
		--rustc)
			RUSTC=$2
			shift 2
			;;
		--source)
			SOURCE=$2
			shift 2
			;;
		--out-dir)
			OUT_DIR=$2
			shift 2
			;;
		--)
			shift
			break
			;;
	esac
done

# Validate required arguments
if [ -z "${RUSTC-}" ] || [ -z "${SOURCE-}" ] || [ -z "${OUT_DIR-}" ] || [ -z "${TANGRAM_OUTPUT-}" ]; then
	die "Missing required argument or environment variable"
fi

# Create output directories
mkdir -p "$TANGRAM_OUTPUT/out" "$TANGRAM_OUTPUT/build" "$TANGRAM_OUTPUT/log" || die "Failed to create output directories"

# Change to the source directory
cd "$SOURCE" || die "Failed to change to source directory: $SOURCE"

# Copy over the OUT_DIR contents.
cp -R "$OUT_DIR/." "$TANGRAM_OUTPUT/out" || die "Failed to copy $OUT_DIR to $TANGRAM_OUTPUT/out"

# Invoke the compiler
if ! OUT_DIR="$TANGRAM_OUTPUT/out" "$RUSTC" "$@" --out-dir "$TANGRAM_OUTPUT/build" \
		 > "$TANGRAM_OUTPUT/log/stdout" 2> "$TANGRAM_OUTPUT/log/stderr"; then
	log "rustc failed. Error output:"
	cat "$TANGRAM_OUTPUT/log/stderr"
	exit 1
fi
