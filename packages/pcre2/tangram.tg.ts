import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "pcre2",
	version: "10.43",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:889d16be5abb8d05400b33c25e151638b8d4bac0e2d9c76e9d6923118ae8a34e";
	let owner = "PCRE2Project";
	let repo = name;
	let tag = `pcre2-${version}`;
	return std.download.fromGithub({
		checksum,
		owner,
		release: true,
		repo,
		tag,
		version,
	});
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let pcre2 = tg.target(async (arg?: Arg) => {
	let { autotools = [], build, host, source: source_, ...rest } = arg ?? {};

	return std.autotools.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default pcre2;

export let test = tg.target(async () => {
	let source = tg.directory({
		["main.c"]: tg.file(`
			#include <stdio.h>
			int main () {}
		`),
	});

	let host = await std.triple.host();
	let hostArch = host.arch;

	let output = tg.File.expect(
		await std.build(
			tg`
				echo "Checking if we can link against libpcre2."
				cc ${source}/main.c -o $OUTPUT -lpcre2-8
			`,
			{ env: [std.sdk(), pcre2()] },
		),
	);
	let metadata = await std.file.executableMetadata(output);
	tg.assert(metadata.format === "elf");
	tg.assert(metadata.arch === hostArch);

	// // On Linux, test cross-compilation.
	// let os = std.triple.os(std.triple.archAndOs(host));
	// if (os === "linux") {
	// 	// Determine the target triple with differing architecture from the host.
	// 	let targetArch: std.triple.Arch =
	// 		hostArch === "x86_64" ? "aarch64" : "x86_64";
	// 	let target = tg.triple({
	// 		arch: targetArch,
	// 		vendor: "unknown",
	// 		os: "linux",
	// 		environment: "gnu",
	// 	});

	// 	// Assert that we cross-compile a binary for the target.
	// 	let output = tg.File.expect(
	// 		await std.build(
	// 			tg`
	// 				echo "Checking if we can link against a cross-compiled libpcre2."
	// 				${std.triple.toString(target)}-cc ${source}/main.c -o $OUTPUT -L${pcre2({
	// 					host,
	// 				})}/lib -lpcre2-8
	// 			`,
	// 			{ env: std.sdk() },
	// 		),
	// 	);
	// 	let metadata = await std.file.executableMetadata(output);
	// 	tg.assert(metadata.format === "elf");
	// 	tg.assert(metadata.arch === targetArch);
	// }
	return true;
});
