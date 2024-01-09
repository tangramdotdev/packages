import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "pcre2",
	version: "10.42",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:c33b418e3b936ee3153de2c61cc638e7e4fe3156022a5c77d0711bcbb9d64f1f";
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
	build?: std.Triple.Arg;
	env?: std.env.Arg;
	host?: std.Triple.Arg;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let pcre2 = tg.target(async (arg?: Arg) => {
	let { autotools = [], build, host, source: source_, ...rest } = arg ?? {};

	return std.autotools.build(
		{
			...rest,
			...std.Triple.rotate({ build, host }),
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

	let host = await std.Triple.host();
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
	// let os = tg.System.os(std.Triple.system(host));
	// if (os === "linux") {
	// 	// Determine the target triple with differing architecture from the host.
	// 	let targetArch: std.Triple.Arch =
	// 		hostArch === "x86_64" ? "aarch64" : "x86_64";
	// 	let target = std.triple({
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
	// 				${std.Triple.toString(target)}-cc ${source}/main.c -o $OUTPUT -L${pcre2({
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
