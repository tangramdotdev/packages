import * as std from "std" with { local: "./std" };
import * as cmake from "cmake" with { local: "./cmake" };
import * as ogg from "ogg" with { local: "./ogg.tg.ts" };

export const metadata = {
	homepage: "https://xiph.org/flac",
	name: "flac",
	version: "1.5.0",
	tag: "flac/1.5.0",
	provides: {
		binaries: ["flac", "metaflac"],
		libraries: [
			{ name: "FLAC", pkgConfigName: "flac", dylib: false },
			{ name: "FLAC++", pkgConfigName: "flac++", dylib: false },
		],
	},
};

export const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:f2c1c76592a82ffff8413ba3c4a1299b6c7ab06c734dee03fd88630485c2b920";
	return std
		.download({
			url: `https://ftp.osuosl.org/pub/xiph/releases/${name}/${name}-${version}.tar.xz`,
			checksum,
			mode: "extract",
		})
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
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
