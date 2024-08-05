import * as std from "tg:std" with { path: "../std" };
import { $ } from "tg:std" with { path: "../std" };

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
		env,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	let configureArgs = [
		"--disable-dependency-tracking",
		"--enable-fast-install=no",
	];
	if (build !== host) {
		configureArgs = configureArgs.concat([
			`--build=${build}`,
			`--host=${host}`,
		]);
	}
	let configure = { args: configureArgs };
	let phases = { configure };

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			phases,
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

	let output = await $`
				echo "Checking if we can link against libpcre2."
				cc ${source}/main.c -o $OUTPUT -lpcre2-8
			`
		.env(std.sdk(), build())
		.then(tg.File.expect);
	return output;
});
