import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "libyaml",
	version: "0.2.5",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:c642ae9b75fee120b2d96c712538bd2cf283228d2337df2cf2988e3c02678ef4";
	let extension = ".tar.gz";
	let url = `https://github.com/yaml/libyaml/releases/download/${version}/yaml-${version}${extension}`;
	let download = tg.Directory.expect(await std.download({ url, checksum }));
	return std.directory.unwrap(download);
});

type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let libyaml = tg.target(async (...args: std.Args<Arg>) => {
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
			env,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default libyaml;

export let test = tg.target(async () => {
	let source = tg.directory({
		["main.c"]: tg.file(`
			#include <stdio.h>
			int main () {}
		`),
	});

	return std.build(
		tg`
			echo "Checking if we can link against libyaml."
			cc ${source}/main.c -o $OUTPUT -lyaml
		`,
		{ env: std.env.arg(std.sdk(), libyaml()) },
	);
});
