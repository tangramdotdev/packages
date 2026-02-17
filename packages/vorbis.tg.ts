import * as std from "std" with { local: "./std" };
import * as cmake from "cmake" with { local: "./cmake" };
import * as ogg from "ogg" with { local: "./ogg.tg.ts" };

export const metadata = {
	homepage: "https://xiph.org/vorbis",
	name: "vorbis",
	version: "1.3.7",
	tag: "vorbis/1.3.7",
	provides: {
		libraries: [
			{ name: "vorbis", dylib: false },
			{ name: "vorbisenc", dylib: false },
			{ name: "vorbisfile", dylib: false },
		],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:b33cc4934322bcbf6efcbacf49e3ca01aadbea4114ec9589d1b1e9d20f72954b";
	return std
		.download({
			url: `https://ftp.osuosl.org/pub/xiph/releases/${name}/lib${name}-${version}.tar.xz`,
			checksum,
			mode: "extract",
		})
		.then(tg.Directory.expect)
		.then((directory) => directory.get(`lib${name}-${version}`))
		.then(tg.Directory.expect);
};

export const deps = () =>
	std.deps({
		ogg: ogg.build,
	});

export type Arg = cmake.Arg & std.deps.Arg<typeof deps>;

export const build = (...args: std.Args<Arg>) =>
	cmake.build(
		{
			source: source(),
			deps,
			phases: {
				configure: {
					args: ["-DCMAKE_INSTALL_LIBDIR=lib"],
				},
			},
		},
		...args,
	);

export const env = () =>
	std.env.arg({
		PKG_CONFIG_PATH: tg.Mutation.suffix(tg`${build()}/lib/pkgconfig`, ":"),
	});

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
