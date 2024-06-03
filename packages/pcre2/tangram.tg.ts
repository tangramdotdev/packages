import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://github.com/PCRE2Project/pcre2",
	name: "pcre2",
	repository: "https://github.com/PCRE2Project/pcre2",
	license: "https://github.com/PCRE2Project/pcre2/blob/master/LICENCE",
	version: "10.43",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:889d16be5abb8d05400b33c25e151638b8d4bac0e2d9c76e9d6923118ae8a34e";
	let owner = "PCRE2Project";
	let repo = name;
	let tag = `pcre2-${version}`;
	return std.download.fromGithub({
		checksum,
		owner,
		source: "release",
		repo,
		tag,
		version,
	});
});

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let build = tg.target(async (...args: std.Args<Arg>) => {
	let {
		autotools = {},
		build,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	return std.autotools.build(
		{
			...std.triple.rotate({ build, host }),
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default build;

export let test = tg.target(async () => {
	let source = tg.directory({
		["main.c"]: tg.file(`
			#include <stdio.h>
			int main () {}
		`),
	});

	let host = await std.triple.host();
	let hostArch = std.triple.arch(host);

	let output = tg.File.expect(
		await std.build(
			tg`
				echo "Checking if we can link against libpcre2."
				cc ${source}/main.c -o $OUTPUT -lpcre2-8
			`,
			{ env: std.env.arg(std.sdk(), build()) },
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
