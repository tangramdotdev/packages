import * as std from "std" with { source: "./std" };
import * as cmake from "cmake" with { source: "./cmake" };

export const metadata = {
	homepage: "https://opus-codec.org/",
	name: "opus",
	version: "1.6.1",
	tag: "opus/1.6.1",
	provides: {
		libraries: [{ name: "opus", dylib: false }],
	},
};

export async function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:6ffcb593207be92584df15b32466ed64bbec99109f007c82205f0194572411a1";
	return std
		.download({
			url: `https://downloads.xiph.org/releases/${name}/${name}-${version}.tar.gz`,
			checksum,
			mode: "extract",
		})
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
}

export type Arg = cmake.Arg;

export function build(...args: std.Args<Arg>) {
	return cmake.build(
		{
			source: source(),
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
