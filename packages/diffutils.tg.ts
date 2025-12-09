import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://www.gnu.org/software/diffutils/",
	license: "GPL-3.0-or-later",
	name: "diffutils",
	repository: "https://git.savannah.gnu.org/cgit/diffutils.git",
	version: "3.12",
	tag: "diffutils/3.12",
	provides: {
		binaries: ["cmp", "diff", "diff3"],
	},
};

const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:7c8b7f9fc8609141fdea9cece85249d308624391ff61dedaf528fcb337727dfd";
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
