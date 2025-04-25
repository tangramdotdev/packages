import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://tukaani.org/xz/",
	name: "xz",
	version: "5.6.3",
	provides: {
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
		// FIXME the header tests choke on these.
		// headers: [
		// 	"lzma/base.h",
		// 	"lzma/bcj.h",
		// 	"lzma/block.h",
		// 	"lzma/check.h",
		// 	"lzma/container.h",
		// 	"lzma/delta.h",
		// 	"lzma/filter.h",
		// 	"lzma/hardware.h",
		// 	"lzma/index.h",
		// 	"lzma/index_hash.h",
		// 	"lzma/lzma12.h",
		// 	"lzma/stream_flags.h",
		// 	"lzma/version.h",
		// 	"lzma/vli.h",
		// 	"lzma.h",
		// ],
		libraries: ["lzma"],
	},
};

export const source = tg.command(async () => {
	const { name, version } = metadata;
	const extension = ".tar.gz";
	const checksum =
		"sha256:b1d45295d3f71f25a4c9101bd7c8d16cb56348bbef3bbc738da0351e17c73317";
	const base = `https://github.com/tukaani-project/xz/releases/download/v${version}`;
	return await std.download
		.extractArchive({ base, checksum, name, version, extension })
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

export const build = tg.command(async (...args: std.Args<Arg>) => {
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

export default build;

export const run = tg.command(async (...args: Array<tg.Value>) => {
	const dir = await build.build();
	return await tg.run({ executable: tg.symlink(tg`${dir}/bin/xz`), args });
});

export const test = tg.command(async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
});
