import * as std from "std" with { source: "./std" };

export const metadata = {
	builds: { exports: ["default", "build"] },
	homepage: "https://www.hadrons.org/software/libmd/",
	license: "BSD-3-Clause",
	name: "libmd",
	repository: "https://gitlab.freedesktop.org/libbsd/libmd",
	version: "1.3.0",
	tag: "libmd/1.3.0",
	provides: {
		headers: ["md5.h", "sha2.h"],
		libraries: ["md"],
	},
};

export function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:fc0f1eb6b6766470326f2c014693809190e67dba84274a6fbae9d4912d066706";
	return std
		.download({
			url: `https://libbsd.freedesktop.org/releases/${name}-${version}.tar.xz`,
			checksum,
			mode: "extract",
		})
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
}

export type Arg = std.autotools.Arg;

export function build(...args: tg.Args<Arg>) {
	return std.autotools.build(
		{
			source: source(),
			phases: { configure: { args: ["--enable-static"] } },
		},
		...args,
	);
}

export default build;

export async function test() {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
}
