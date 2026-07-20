import * as nasm from "nasm" with { source: "./nasm.tg.ts" };
import * as std from "std" with { source: "./std" };

export const metadata = {
	homepage: "https://www.ffmpeg.org/",
	name: "FFmpeg",
	repository: "https://github.com/FFmpeg/FFmpeg",
	version: "8.1.2",
	tag: "ffmpeg/8.1.2",
	provides: {
		binaries: ["ffmpeg", "ffprobe"],
		libraries: [
			{ name: "avcodec", dylib: false },
			{ name: "avdevice", dylib: false },
			{ name: "avfilter", dylib: false },
			{ name: "avformat", dylib: false },
			{ name: "avutil", dylib: false },
			{ name: "swresample", dylib: false },
			{ name: "swscale", dylib: false },
		],
	},
};

export function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:9fd092511605bbebafe095ea6d38d9e40f34d12f7386e1258372df8be0576eb7";
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
}

export function deps() {
	return std.deps({
		nasm: { build: nasm.build, kind: "buildtime" },
	});
}

export type Arg = std.autotools.Arg & std.deps.Arg<typeof deps>;

export function build(...args: std.Args<Arg>) {
	return std.autotools.build(
		{
			source: source(),
			deps,
			phases: {
				configure: { args: ["--disable-stripping"] },
			},
		},
		...args,
	);
}

export default build;

export async function test() {
	return await std.assert.pkg(build, {
		// ffmpeg uses -version (single dash), not --version.
		binaries: std.assert.allBinaries(["ffmpeg", "ffprobe"], {
			testArgs: ["-version"],
			snapshot: metadata.version,
		}),
		// Static-only libs need `pkg-config --libs --static` for transitive deps;
		// the test framework uses `--libs` without `--static`, so skip link tests.
	});
}
