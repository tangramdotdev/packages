import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://www.gnu.org/software/gawk/",
	name: "gawk",
	license: "GPL-3.0-or-later",
	repository: "https://git.savannah.gnu.org/git/gawk.git",
	version: "5.3.2",
	tag: "gawk/5.3.2",
	provides: {
		binaries: ["gawk"],
	},
};

const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:f8c3486509de705192138b00ef2c00bbbdd0e84c30d5c07d23fc73a9dc4cc9cc";
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
