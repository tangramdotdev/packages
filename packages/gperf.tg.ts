import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://www.gnu.org/software/gperf/",
	license: "GPL-3.0-or-later",
	name: "gperf",
	repository: "https://git.savannah.gnu.org/git/gperf.git",
	version: "3.1",
	tag: "gperf/3.1",
	provides: {
		binaries: ["gperf"],
	},
};

const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:588546b945bba4b70b6a3a616e80b4ab466e3f33024a352fc2198112cdbb3ae2";
	return std.download.fromGnu({ name, version, checksum });
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
