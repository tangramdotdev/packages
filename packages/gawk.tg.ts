import * as std from "std" with { source: "./std" };

export const metadata = {
	homepage: "https://www.gnu.org/software/gawk/",
	name: "gawk",
	license: "GPL-3.0-or-later",
	repository: "https://git.savannah.gnu.org/git/gawk.git",
	version: "5.4.1",
	tag: "gawk/5.4.1",
	provides: {
		binaries: ["gawk"],
	},
};

function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:07f6f7342b7febe4313fc2c2542ad93d64fe20ad8717200109f105a826f5fd37";
	return std.download.fromGnu({
		name,
		version,
		checksum,
		compression: "xz",
	});
}

export type Arg = std.autotools.Arg;

export function build(...args: std.Args<Arg>) {
	return std.autotools.build({ source: source() }, ...args);
}

export default build;

export async function test() {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
}
