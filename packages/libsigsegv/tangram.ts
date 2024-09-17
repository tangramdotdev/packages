import * as std from "tg:std" with { path: "../std" };
import { $ } from "tg:std" with { path: "../std" };

export const metadata = {
	homepage: "https://www.gnu.org/software/libsigsegv/",
	license: "GPL-2.0-or-later",
	name: "libsigsegv",
	repository: "https://git.savannah.gnu.org/gitweb/?p=libsigsegv.git",
	version: "2.14",
};

export const source = tg.target(() => {
	const { name, version } = metadata;
	const checksum =
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

export const build = tg.target(async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		env,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
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
			echo "Checking if we can link against libsigsegv."
			cc ${source}/main.c -o $OUTPUT -lsigsegv
		`.env(std.sdk(), build());
});
