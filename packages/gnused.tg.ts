import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://www.gnu.org/software/sed/",
	license: "GPL-2.0-or-later",
	name: "sed",
	repository: "https://git.savannah.gnu.org/cgit/sed.git",
	version: "4.9",
	tag: "gnused/4.9",
	provides: {
		binaries: ["sed"],
	},
};

const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:6e226b732e1cd739464ad6862bd1a1aba42d7982922da7a53519631d24975181";
	return std.download.fromGnu({
		name,
		version,
		checksum,
		compression: "xz",
	});
};

export type Arg = std.autotools.Arg;

export const build = (...args: std.Args<Arg>) =>
	std.autotools.build(
		std.autotools.arg(
			{
				source: source(),
				phases: {
					configure: { args: ["--disable-dependency-tracking"] },
				},
			},
			...args,
		),
	);

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
