import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://tukaani.org/xz/",
	name: "xz",
	version: "5.4.6",
};

export const source = tg.target(async () => {
	const { name, version } = metadata;
	const extension = ".tar.gz";
	const checksum =
		"sha256:aeba3e03bf8140ddedf62a0a367158340520f6b384f75ca6045ccc6c0d43fd5c";
	const base = `https://downloads.sourceforge.net/project/lzmautils`;
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

export const default_ = tg.target(async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		env,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);
	const configure = {
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

export default default_;

export const test = tg.target(async () => {
	await std.assert.pkg({
		packageDir: default_(),
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
