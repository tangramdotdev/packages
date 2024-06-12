import * as std from "tg:std" with { path: "../std" };
import { $ } from "tg:std" with { path: "../std" };

export let metadata = {
	name: "gmp",
	version: "6.2.1",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:fd4829912cddd12f84181c3451cc752be224643e87fac497b69edddadc49b4f2";
	let extension = ".tar.xz";
	let packageArchive = std.download.packageArchive({
		extension,
		name,
		version,
	});
	let url = `https://gmplib.org/download/${name}/${packageArchive}`;
	let download = tg.Directory.expect(await std.download({ checksum, url }));
	return std.directory.unwrap(download);
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
		autotools = [],
		build,
		env,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	return std.autotools.build(
		{
			...std.triple.rotate({ build, host }),
			doCheck: true,
			env,
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
			echo "Checking if we can link against libgmp."
			cc ${source}/main.c -o $OUTPUT -lgmp
		`.env(std.sdk(), build());
});
