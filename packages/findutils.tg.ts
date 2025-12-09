import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://www.gnu.org/software/findutils/",
	name: "findutils",
	license: "GPL-3.0-or-later",
	repository: "https://git.savannah.gnu.org/cgit/findutils.git",
	version: "4.10.0",
	tag: "findutils/4.10.0",
	provides: {
		binaries: ["find", "locate", "updatedb", "xargs"],
	},
};

const source = () => {
	const { name, version } = metadata;
	const compression = "xz";
	const checksum =
		"sha256:1387e0b67ff247d2abde998f90dfbf70c1491391a59ddfecb8ae698789f0a4f5";
	return std.download.fromGnu({ name, version, checksum, compression });
};

export type Arg = std.autotools.Arg;

export const build = (...args: std.Args<Arg>) =>
	std.autotools.build({ source: source() }, ...args);

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
