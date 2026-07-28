import * as std from "std" with { source: "./std" };

export const metadata = {
	homepage: "https://www.gnu.org/software/gperf/",
	license: "GPL-3.0-or-later",
	name: "gperf",
	repository: "https://git.savannah.gnu.org/git/gperf.git",
	version: "3.3",
	tag: "gperf/3.3",
	provides: {
		binaries: ["gperf"],
	},
};

function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:fd87e0aba7e43ae054837afd6cd4db03a3f2693deb3619085e6ed9d8d9604ad8";
	return std.download.fromGnu({ name, version, checksum });
}

export type Arg = std.autotools.Arg;

export function build(...args: tg.Args<Arg>) {
	return std.autotools.build(
		{
			source: source(),
			phases: {
				configure: { args: ["--disable-dependency-tracking"] },
			},
		},
		...args,
	);
}

export default build;

export async function test() {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
}
