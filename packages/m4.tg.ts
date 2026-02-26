import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://www.gnu.org/software/m4/",
	license: "GPL-3.0-or-later",
	name: "m4",
	repository: "https://git.savannah.gnu.org/cgit/m4.git",
	version: "1.4.21",
	tag: "m4/1.4.21",
	provides: {
		binaries: ["m4"],
	},
};

const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:f25c6ab51548a73a75558742fb031e0625d6485fe5f9155949d6486a2408ab66";
	return std.download.fromGnu({ name, version, compression: "xz", checksum });
};

export type Arg = std.autotools.Arg;

export const build = (...args: std.Args<Arg>) =>
	std.autotools.build(
		{
			source: source(),
			phases: {
				configure: { args: ["--disable-dependency-tracking"] },
			},
		},
		...args,
	);

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
