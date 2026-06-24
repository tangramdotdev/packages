import * as std from "std" with { source: "./std" };

export const metadata = {
	homepage: "https://www.gnu.org/software/libiconv/",
	name: "libiconv",
	license: "LGPL-2.1-or-later",
	repository: "https://git.savannah.gnu.org/git/libiconv.git",
	version: "1.19",
	tag: "libiconv/1.19",
	provides: {
		binaries: ["iconv"],
		headers: ["iconv.h", "libcharset.h", "localcharset.h"],
		libraries: [
			{ name: "charset", pkgConfigName: false },
			{ name: "iconv", pkgConfigName: false, dylib: true, staticlib: false },
		],
	},
};

function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:88dd96a8c0464eca144fc791ae60cd31cd8ee78321e67397e25fc095c4a19aa6";
	return std.download.fromGnu({ name, version, checksum });
}

export type Arg = std.autotools.Arg;

export function build(...args: std.Args<Arg>) {
	return std.autotools.build({ source: source() }, ...args);
}

export default build;

export async function test() {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
}
