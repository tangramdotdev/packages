import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://tukaani.org/xz/",
	name: "xz",
	version: "5.4.6",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let extension = ".tar.gz";
	let checksum =
		"sha256:aeba3e03bf8140ddedf62a0a367158340520f6b384f75ca6045ccc6c0d43fd5c";
	let base = `https://downloads.sourceforge.net/project/lzmautils`;
	return await std
		.download({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
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
	let configure = {
		args: [
			"--disable-debug",
			"--disable-dependency-tracking",
			"--disable-nls",
			"--disable-silent-rules",
		],
	};

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			phases: { configure },
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default build;

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: build,
		binaries: [
			"lzmadec",
			"lzmainfo",
			"xz",
			"xzdec",
			"xzdiff",
			"xzgrep",
			"xzless",
			"xzmore",
		],
		libraries: ["lzma"],
		metadata,
	});
	return true;
});
