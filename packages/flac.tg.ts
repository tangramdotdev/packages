import * as std from "std" with { source: "./std" };
import * as cmake from "cmake" with { source: "./cmake" };
import * as ogg from "ogg" with { source: "./ogg.tg.ts" };

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

export async function source() {
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
}

export function deps() {
	return std.deps({
		ogg: ogg.build,
	});
}

export type Arg = cmake.Arg & std.deps.Arg<typeof deps>;

export function build(...args: std.Args<Arg>) {
	return cmake.build(
		{
			source: source(),
			deps,
		},
		...args,
	);
}

export function env() {
	return std.env.arg({
		PKG_CONFIG_PATH: tg.Mutation.suffix(tg`${build()}/lib/pkgconfig`, ":"),
	});
}

export default build;

export async function test() {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
}
