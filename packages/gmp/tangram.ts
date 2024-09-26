import * as std from "std" with { path: "../std" };
import { $ } from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://gmplib.org",
	license: "LGPL-3.0-or-later",
	name: "gmp",
	version: "6.3.0",
};

export const source = tg.target(async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:a3c2b80201b89e68616f4ad30bc66aee4927c3ce50e33929ca819d5c43538898";
	const extension = ".tar.xz";
	const base = `https://gmplib.org/download/${name}`;
	return await std
		.download({ base, checksum, extension, name, version })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = tg.target(async (...args: std.Args<Arg>) => {
	const {
		autotools = [],
		build,
		env,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			doCheck: true,
			env,
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
			echo "Checking if we can link against libgmp."
			cc ${source}/main.c -o $OUTPUT -lgmp
		`.env(std.sdk(), build());
});
