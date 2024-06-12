import * as gmp from "tg:gmp" with { path: "../gmp" };
import * as std from "tg:std" with { path: "../std" };
import { $ } from "tg:std" with { path: "../std" };

export let metadata = {
	name: "nettle",
	version: "3.8.1",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:364f3e2b77cd7dcde83fd7c45219c834e54b0c75e428b6f894a23d12dd41cbfe";
	return std.download.fromGnu({ name, version, checksum });
});

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		gmp?: gmp.Arg;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let build = tg.target(async (...args: std.Args<Arg>) => {
	let {
		autotools = {},
		build,
		dependencies: { gmp: gmpArg = {} } = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	let env = [gmp.build(gmpArg), env_];

	let configure = {
		args: [
			"--disable-dependency-tracking",
			"--disable-documentation",
			"--libdir=$OUTPUT/lib",
		],
	};
	let phases = { configure };

	return std.autotools.build(
		{
			...std.triple.rotate({ build, host }),
			env: std.env.arg(env),
			phases,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export let test = tg.target(async () => {
	let source = tg.directory({
		["main.c"]: tg.file(`
			#include <stdio.h>
			int main () {}
		`),
	});

	return await $`
			echo "Checking if we can link against nettle and hogweed."
			cc ${source}/main.c -o $OUTPUT -lnettle -lhogweed -lgmp
		`.env(std.sdk(), build(), gmp.build());
});
