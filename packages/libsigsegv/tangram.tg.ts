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
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let libsigsegv = tg.target(async (...args: std.Args<Arg>) => {
	let {
		autotools = {},
		build,
		env,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	return std.autotools.build(
		{
			...std.triple.rotate({ build, host }),
			env,
			sdk,
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
		{ env: std.env.arg(std.sdk(), libsigsegv()) },
	);
});
