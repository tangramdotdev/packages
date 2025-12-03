import * as cmake from "cmake" with { local: "../cmake" };
import * as flac from "flac" with { local: "../flac" };
import * as ogg from "ogg" with { local: "../ogg" };
import * as opus from "opus" with { local: "../opus" };
import * as vorbis from "vorbis" with { local: "../vorbis" };
import * as std from "std" with { local: "../std" };

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

export const source = async (): Promise<tg.Directory> => {
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

export type Arg = cmake.Arg;

export const build = async (...args:std.Args<Arg>) => {
	return cmake.build(
		{ source: source() },
		{ env: std.env.arg(flac.env()) },
		{ env: std.env.arg(ogg.env()) },
		{ env: std.env.arg(opus.env()) },
		{ env: std.env.arg(vorbis.env()) },
		...args,
	);
};

export const env = () => std.env.arg({
	PKG_CONFIG_PATH: tg.Mutation.suffix(tg`${build()}/lib64/pkgconfig`, ":"),
});

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
