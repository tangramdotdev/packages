import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "gmp",
	version: "6.2.1",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:fd4829912cddd12f84181c3451cc752be224643e87fac497b69edddadc49b4f2";
	let unpackFormat = ".tar.xz" as const;
	let url = `https://gmplib.org/download/${name}/${name}-${version}${unpackFormat}`;
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
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let gmp = tg.target(async (arg?: Arg) => {
	let { autotools = [], build, host, source: source_, ...rest } = arg ?? {};

	return std.autotools.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			doCheck: true,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default gmp;

export let test = tg.target(() => {
	let source = tg.directory({
		["main.c"]: tg.file(`
			#include <stdio.h>
			int main () {}
		`),
	});

	return std.build(
		tg`
			echo "Checking if we can link against libgmp."
			cc ${source}/main.c -o $OUTPUT -lgmp
		`,
		{ env: [std.sdk(), gmp()] },
	);
});
