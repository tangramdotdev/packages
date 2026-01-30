/**
 * Returns the shell command for normalizing .pc files in a fixup phase.
 *
 * This command normalizes pkg-config files to use relative paths:
 * - prefix=${pcfiledir}/../..
 * - exec_prefix=${prefix}
 * - libdir=${exec_prefix}/lib or ${exec_prefix}/lib64
 * - includedir=${prefix}/include
 */
export const shellNormalizeCommand = (): Promise<tg.Template> => {
	// The sed command normalizes all path-related variables.
	// Note: We use ${pcfiledir} which pkg-config expands to the directory containing the .pc file.
	// The /../.. assumes .pc files are in lib/pkgconfig/ relative to prefix.
	// The quoting trick $'"{varname}"' breaks out of single quotes to insert a literal ${varname}.
	return tg`find ${tg.output} -name '*.pc' -type f -exec sed -i \
  -e 's|^prefix=.*|prefix=$'"{pcfiledir}"'/../..|' \
  -e 's|^exec_prefix=.*|exec_prefix=$'"{prefix}"'|' \
  -e 's|^libdir=.*/lib64$|libdir=$'"{exec_prefix}"'/lib64|' \
  -e 's|^libdir=.*/lib$|libdir=$'"{exec_prefix}"'/lib|' \
  -e 's|^includedir=.*/include$|includedir=$'"{prefix}"'/include|' \
  {} \\;`;
};

/** Apply normalization to .pc file content. Used for testing. */
const normalizeContent = (content: string): string => {
	return content
		.replace(/^prefix=.*/m, "prefix=${pcfiledir}/../..")
		.replace(/^exec_prefix=.*/m, "exec_prefix=${prefix}")
		.replace(/^libdir=.*\/lib64$/m, "libdir=${exec_prefix}/lib64")
		.replace(/^libdir=.*\/lib$/m, "libdir=${exec_prefix}/lib")
		.replace(/^includedir=.*\/include$/m, "includedir=${prefix}/include");
};

export const test = async () => {
	const input = `prefix=/opt/.tangram/tmp/abc123/output
exec_prefix=/opt/.tangram/tmp/abc123/output
libdir=/opt/.tangram/tmp/abc123/output/lib
includedir=/opt/.tangram/tmp/abc123/output/include

Name: example
Version: 1.0.0`;

	const output = normalizeContent(input);
	const lines = output.split("\n");

	const get = (key: string) => lines.find((l) => l.startsWith(`${key}=`));

	tg.assert(get("prefix") === "prefix=${pcfiledir}/../..", `prefix mismatch: ${get("prefix")}`);
	tg.assert(get("exec_prefix") === "exec_prefix=${prefix}", `exec_prefix mismatch: ${get("exec_prefix")}`);
	tg.assert(get("libdir") === "libdir=${exec_prefix}/lib", `libdir mismatch: ${get("libdir")}`);
	tg.assert(get("includedir") === "includedir=${prefix}/include", `includedir mismatch: ${get("includedir")}`);

	// Test lib64 variant.
	const lib64Input = `libdir=/some/path/lib64`;
	const lib64Output = normalizeContent(lib64Input);
	tg.assert(lib64Output === "libdir=${exec_prefix}/lib64", `lib64 mismatch: ${lib64Output}`);

	console.log("pkgconfig normalization tests passed");
	return true;
};
