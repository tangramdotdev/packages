import * as gmp from "tg:gmp" with { path: "../gmp" };
import * as std from "tg:std" with { path: "../std" };
import { $ } from "tg:std" with { path: "../std" };

export const metadata = {
	homepage: "https://www.lysator.liu.se/~nisse/nettle/",
	license: "LGPL-3.0-or-later",
	name: "nettle",
	repository: "https://git.lysator.liu.se/nettle/nettle",
	version: "3.8.1",
};

export const source = tg.target(() => {
	const { name, version } = metadata;
	const checksum =
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

export const build = tg.target(async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		dependencies: { gmp: gmpArg = {} } = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	const env = [gmp.build({ build, env: env_, host, sdk }, gmpArg), env_];

	const configure = {
		args: [
			"--disable-dependency-tracking",
			"--disable-documentation",
			"--libdir=$OUTPUT/lib",
		],
	};
	const phases = { configure };

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env: std.env.arg(env),
			phases,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default build;

export const test = tg.target(async () => {
	const source = tg.directory({
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
