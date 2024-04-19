import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://zlib.net",
	license: "https://zlib.net/zlib_license.html",
	name: "zlib",
	version: "1.3.1",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:38ef96b8dfe510d42707d9c781877914792541133e1870841463bfa73f883e32";
	let extension = ".tar.xz";
	let packageArchive = std.download.packageArchive({
		extension,
		name,
		version,
	});
	let url = `https://zlib.net/${packageArchive}`;
	let download = tg.Directory.expect(await std.download({ checksum, url }));
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

export let zlib = tg.target((arg?: Arg) => {
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

export default zlib;

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: zlib,
		docs: ["man/man3/zlib.3"],
		pkgConfigName: "zlib",
		libraries: ["z"],
	});
	return true;
});
