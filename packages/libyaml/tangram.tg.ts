import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "libyaml",
	version: "0.2.5",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:c642ae9b75fee120b2d96c712538bd2cf283228d2337df2cf2988e3c02678ef4";
	let unpackFormat = ".tar.gz" as const;
	let url = `https://github.com/yaml/libyaml/releases/download/${version}/yaml-${version}${unpackFormat}`;
	let download = tg.Directory.expect(
		await std.download({
			url,
			checksum,
			unpackFormat,
		}),
	);
	return std.directory.unwrap(download);
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let libyaml = tg.target(async (arg?: Arg) => {
	let { autotools = [], build, host, source: source_, ...rest } = arg ?? {};

	return std.autotools.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
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
		{ env: [std.sdk(), libyaml()] },
	);
});
