import * as std from "std" with { local: "./std" };
import nasm from "nasm" with { local: "./nasm.tg.ts" };
import { $ } from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://www.ffmpeg.org/",
	name: "FFmpeg",
	repository: "https://github.com/FFmpeg/FFmpeg",
	version: "7.1.2",
	tag: "n7.1.2",
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

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		dependencies: dependencyArgs = {},
		env,
		host,
		sdk,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

	const configure = {
		args: ["--disable-stripping"],
	};
	const phases = { configure };

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env: std.env.arg(env, nasm()),
			phases,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);
};

export default build;
