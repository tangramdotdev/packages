import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://zlib.net",
	license: "https://zlib.net/zlib_license.html",
	name: "zlib",
	version: "1.3",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:8a9ba2898e1d0d774eca6ba5b4627a11e5588ba85c8851336eb38de4683050a7";
	let unpackFormat = ".tar.xz" as const;
	let url = `https://zlib.net/${name}-${version}${unpackFormat}`;
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

export let zlib = tg.target((arg?: Arg) => {
	let { autotools = [], build, host, source: source_, ...rest } = arg ?? {};

	return std.autotools.build(
		{
			...rest,
			...std.Triple.rotate({ build, host }),
			phases: { phases: { prepare: "echo 'hi!!' && env" } },
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default zlib;

export let test = tg.target(async () => {
	let zlibArtifact = await zlib();
	return zlibArtifact;
	// await std.assert.pkg({
	// 	directory: zlibArtifact,
	// 	docs: ["man/man3/zlib.3"],
	// 	headers: ["zconf.h", "zlib.h"],
	// 	libs: ["z"],
	// 	pkgConfigName: "zlib",
	// });
	// return true;
});
