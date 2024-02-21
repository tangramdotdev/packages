import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "libsigsegv",
	version: "2.14",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:cdac3941803364cf81a908499beb79c200ead60b6b5b40cad124fd1e06caa295";

	return std.download.fromGnu({ name, version, checksum });
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: tg.Triple.Arg;
	env?: std.env.Arg;
	host?: tg.Triple.Arg;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let libsigsegv = tg.target(async (arg?: Arg) => {
	let { autotools = [], build, host, source: source_, ...rest } = arg ?? {};

	return std.autotools.build(
		{
			...rest,
			...tg.Triple.rotate({ build, host }),
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default libsigsegv;

export let test = tg.target(() => {
	let source = tg.directory({
		["main.c"]: tg.file(`
			#include <stdio.h>
			int main () {}
		`),
	});

	return std.build(
		tg`
			echo "Checking if we can link against libsigsegv."
			cc ${source}/main.c -o $OUTPUT -lsigsegv
		`,
		{ env: [std.sdk(), libsigsegv()] },
	);
});
