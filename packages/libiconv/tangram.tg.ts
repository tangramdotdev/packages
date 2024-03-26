import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://www.gnu.org/software/libiconv/",
	name: "libiconv",
	license: "LGPL-2.1-or-later",
	repository: "https://git.savannah.gnu.org/git/libiconv.git",
	version: "1.17",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:8f74213b56238c85a50a5329f77e06198771e70dd9a739779f4c02f65d971313";
	return std.download.fromGnu({ name, version, checksum });
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let libiconv = tg.target(async (arg?: Arg) => {
	let { autotools = [], build, host, source: source_, ...rest } = arg ?? {};

	let output = await std.autotools.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			source: source_ ?? source(),
		},
		autotools,
	);

	let libDir = tg.Directory.expect(await output.get("lib"));
	let unwrappedIconv = tg.File.expect(await output.get("bin/iconv"));
	let wrappedIconv = await std.wrap(unwrappedIconv, {
		libraryPaths: [libDir],
	});
	output = await tg.directory(output, {
		["bin/iconv"]: wrappedIconv,
	});
	return output;
});

export default libiconv;

export let test = tg.target(async () => {
	let directory = libiconv();
	await std.assert.pkg({
		directory,
		binaries: ["iconv"],
		libs: ["charset", { name: "iconv", dylib: true, staticlib: false }],
		metadata,
	});
	return directory;
});
