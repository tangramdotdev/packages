import * as cmake from "cmake" with { local: "./cmake" };
import * as flac from "flac" with { local: "./flac.tg.ts" };
import * as ogg from "ogg" with { local: "./ogg.tg.ts" };
import * as opus from "opus" with { local: "./opus.tg.ts" };
import * as vorbis from "vorbis" with { local: "./vorbis.tg.ts" };
import * as std from "std" with { local: "./std" };

export const metadata = {
	license: "LGPL-2.1",
	name: "libsndfile",
	repository: "https://github.com/libsndfile/libsndfile",
	version: "1.2.2",
	tag: "libsndfile/1.2.2",
	provides: {
		libraries: ["sndfile"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:3799ca9924d3125038880367bf1468e53a1b7e3686a934f098b7e1d286cdb80e";
	const owner = "libsndfile";
	const repo = name;
	const tag = version;

	return std.download.fromGithub({
		checksum,
		compression: "xz",
		owner,
		repo,
		source: "release",
		tag,
		version,
	});
};

const deps = await std.deps({
	flac: flac.build,
	ogg: ogg.build,
	opus: opus.build,
	vorbis: vorbis.build,
});

export type Arg = cmake.Arg & std.deps.Arg<typeof deps>;

export const build = (...args: std.Args<Arg>) =>
	cmake.build({ source: source(), deps }, ...args);

export const env = () =>
	std.env.arg({
		PKG_CONFIG_PATH: tg.Mutation.suffix(tg`${build()}/lib64/pkgconfig`, ":"),
	});

export default build;
