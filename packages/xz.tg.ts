import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://tukaani.org/xz/",
	name: "xz",
	version: "5.8.1",
	tag: "xz/5.8.1",
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
		"sha256:507825b599356c10dca1cd720c9d0d0c9d5400b9de300af00e4d1ea150795543";
	const base = `https://github.com/tukaani-project/xz/releases/download/v${version}`;
	return await std.download
		.extractArchive({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

export type Arg = std.autotools.Arg;

export const build = (...args: std.Args<Arg>) =>
	std.autotools.build(
		std.autotools.arg(
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
		),
	);

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
