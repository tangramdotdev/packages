import * as std from "std" with { source: "../std" };
import patches from "./patches" with { type: "directory" };

export const metadata = {
	homepage: "https://savannah.gnu.org/projects/patch/",
	license: "GPL-3.0-or-later",
	name: "patch",
	repository: "https://git.savannah.gnu.org/cgit/patch.git",
	version: "2.8",
	tag: "patch/2.8",
	provides: {
		binaries: ["patch"],
	},
};

async function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:308a4983ff324521b9b21310bfc2398ca861798f02307c79eb99bb0e0d2bf980";
	return std.download
		.fromGnu({ name, version, checksum })
		.then((source) => std.patch(source, patches));
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
