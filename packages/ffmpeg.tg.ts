import * as nasm from "nasm" with { local: "./nasm.tg.ts" };
import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://www.ffmpeg.org/",
	name: "FFmpeg",
	repository: "https://github.com/FFmpeg/FFmpeg",
	version: "7.1.2",
	tag: "ffmpeg/7.1.2",
	provides: {
		binaries: ["ffmpeg", "ffprobe"],
		libraries: [
			"avcodec",
			"avdevice",
			"avfilter",
			"avformat",
			"avutil",
			"swresample",
			"swscale",
		],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:8cb1bb8cfa9aeae13279b4da42ae8307ae6777456d4270f2e603c95aa08ca8ef";
	const owner = name;
	const repo = name;
	const tag = `n${version}`;
	return std.download.fromGithub({
		owner,
		repo,
		tag,
		checksum,
		source: "tag",
	});
};

const deps = std.deps({
	nasm: { build: nasm.build, kind: "buildtime" },
});

export type Arg = std.autotools.Arg & std.deps.Arg<typeof deps>;

export const build = (...args: std.Args<Arg>) =>
	std.autotools.build(
		{
			source: source(),
			deps,
			phases: {
				configure: { args: ["--disable-stripping"] },
			},
		},
		...args,
	);

export default build;
