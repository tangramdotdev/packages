import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://tukaani.org/xz/",
	name: "xz",
	version: "5.8.2",
	tag: "xz/5.8.2",
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

export const source = async () => {
	const { name, version } = metadata;
	const extension = ".tar.gz";
	const checksum =
		"sha256:ce09c50a5962786b83e5da389c90dd2c15ecd0980a258dd01f70f9e7ce58a8f1";
	const base = `https://github.com/tukaani-project/xz/releases/download/v${version}`;
	return await std.download
		.extractArchive({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

export type Arg = std.autotools.Arg;

export const build = (...args: std.Args<Arg>) =>
	std.autotools.build(
		{
			source: source(),
			phases: {
				configure: {
					args: [
						"--disable-debug",
						"--disable-dependency-tracking",
						"--disable-nls",
						"--disable-silent-rules",
					],
				},
			},
		},
		...args,
	);

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
