import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://www.gnu.org/software/gawk/",
	name: "gawk",
	license: "GPL-3.0-or-later",
	repository: "https://git.savannah.gnu.org/git/gawk.git",
	version: "5.4.0",
	tag: "gawk/5.4.0",
	provides: {
		binaries: ["gawk"],
	},
};

const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:3dd430f0cd3b4428c6c3f6afc021b9cd3c1f8c93f7a688dc268ca428a90b4ac1";
	return std.download.fromGnu({
		name,
		version,
		checksum,
		compression: "xz",
	});
};

export type Arg = std.autotools.Arg;

export const build = (...args: std.Args<Arg>) =>
	std.autotools.build({ source: source() }, ...args);

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
