import * as gmp from "gmp" with { path: "../gmp" };
import m4 from "m4" with { path: "../m4" };
import * as std from "std" with { path: "../std" };
import { $ } from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://www.lysator.liu.se/~nisse/nettle/",
	license: "LGPL-3.0-or-later",
	name: "nettle",
	repository: "https://git.lysator.liu.se/nettle/nettle",
	version: "3.10",
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:b4c518adb174e484cb4acea54118f02380c7133771e7e9beb98a0787194ee47c";
	return std.download.fromGnu({ name, version, checksum });
};

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

export const build = async (...args: tg.Args<Arg>) => {
	const {
		autotools = {},
		build,
		dependencies: { gmp: gmpArg = {} } = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	const env = [
		gmp.build({ build, env: env_, host, sdk }, gmpArg),
		m4({ build, host: build }),
		env_,
	];

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
			env: std.env.arg(...env),
			phases,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);
};

export default build;

export const test = async () => {
	// FIXME spec
	const source = tg.directory({
		["main.c"]: tg.file(`
			#include <stdio.h>
			int main () {}
		`),
	});

	return await $`
			echo "Checking if we can link against nettle and hogweed."
			cc ${source}/main.c -o $OUTPUT -lnettle -lhogweed -lgmp
		`
		.env(std.sdk())
		.env(build())
		.env(gmp.build());
};
