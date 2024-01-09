import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "libffi",
	version: "3.4.4",
};

export let source = tg.target(async (): Promise<tg.Directory> => {
	let { name, version } = metadata;
	let checksum =
		"sha256:d66c56ad259a82cf2a9dfc408b32bf5da52371500b84745f7fb8b645712df676";
	let unpackFormat = ".tar.gz" as const;
	let url = `https://github.com/${name}/${name}/releases/download/v${version}/${name}-${version}${unpackFormat}`;
	let download = tg.Directory.expect(
		await std.download({
			checksum,
			unpackFormat,
			url,
		}),
	);

	return std.directory.unwrap(download);
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: std.Triple.Arg;
	env?: std.env.Arg;
	host?: std.Triple.Arg;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let libffi = tg.target(async (arg?: Arg) => {
	let { autotools = [], build, host, source: source_, ...rest } = arg ?? {};

	return std.autotools.build(
		{
			...rest,
			...std.Triple.rotate({ build, host }),
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default libffi;

export let test = tg.target(async () => {
	let source = tg.directory({
		["main.c"]: tg.file(`
			#include <stdio.h>
			int main () {}
		`),
	});

	return std.build(
		tg`
			echo "Checking if we can link against libffi."
			cc ${source}/main.c -o $OUTPUT -lffi
		`,
		{ env: [std.sdk(), libffi()] },
	);
});
