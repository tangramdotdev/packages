import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://www.gnu.org/software/grep/",
	license: "GPL-2.0-or-later",
	name: "grep",
	repository: "https://git.savannah.gnu.org/cgit/grep.git",
	version: "3.12",
	tag: "gnugrep/3.12",
	provides: {
		binaries: ["grep"],
	},
};

const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:badda546dfc4b9d97e992e2c35f3b5c7f20522ffcbe2f01ba1e9cdcbe7644cdc";
	return std.download.fromGnu({ name, version, checksum });
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
