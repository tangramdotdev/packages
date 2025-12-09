import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://www.gnu.org/software/libsigsegv/",
	license: "GPL-2.0-or-later",
	name: "libsigsegv",
	repository: "https://git.savannah.gnu.org/gitweb/?p=libsigsegv.git",
	version: "2.14",
	tag: "libsigsegv/2.14",
	provides: {
		libraries: ["sigsegv"],
	},
};

const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:cdac3941803364cf81a908499beb79c200ead60b6b5b40cad124fd1e06caa295";

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
