import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://www.gnu.org/software/libiconv/",
	name: "libiconv",
	license: "LGPL-2.1-or-later",
	repository: "https://git.savannah.gnu.org/git/libiconv.git",
	version: "1.18",
	tag: "libiconv/1.18",
	provides: {
		binaries: ["iconv"],
		headers: ["iconv.h", "libcharset.h", "localcharset.h"],
		libraries: [{ name: "charset", pkgConfigName: false }, { name: "iconv", pkgConfigName: false, dylib: true, staticlib: false }],
	},
};

const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:3b08f5f4f9b4eb82f151a7040bfd6fe6c6fb922efe4b1659c66ea933276965e8";
	return std.download.fromGnu({ name, version, checksum });
};

export type Arg = std.autotools.Arg;

export const build = (...args: std.Args<Arg>) =>
	std.autotools.build({ source: source() }, ...args);

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
