import * as std from "std" with { source: "./std" };

export const metadata = {
	homepage: "https://www.gnu.org/software/libsigsegv/",
	license: "GPL-2.0-or-later",
	name: "libsigsegv",
	repository: "https://git.savannah.gnu.org/gitweb/?p=libsigsegv.git",
	version: "2.15",
	tag: "libsigsegv/2.15",
	provides: {
		libraries: [{ name: "sigsegv", pkgConfigName: false, dylib: false }],
	},
};

function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:036855660225cb3817a190fc00e6764ce7836051bacb48d35e26444b8c1729d9";

	return std.download.fromGnu({ name, version, checksum });
}

export type Arg = std.autotools.Arg;

export function build(...args: tg.Args<Arg>) {
	return std.autotools.build({ source: source() }, ...args);
}

export default build;

export async function test() {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
}
