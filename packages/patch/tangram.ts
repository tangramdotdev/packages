import * as std from "std" with { local: "../std" };
import patches from "./patches" with { type: "directory" };

export const metadata = {
	homepage: "https://savannah.gnu.org/projects/patch/",
	license: "GPL-3.0-or-later",
	name: "patch",
	repository: "https://git.savannah.gnu.org/cgit/patch.git",
	version: "2.7.6",
	tag: "patch/2.7.6",
	provides: {
		binaries: ["patch"],
	},
};

const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:8cf86e00ad3aaa6d26aca30640e86b0e3e1f395ed99f189b06d4c9f74bc58a4e";
	return std.download
		.fromGnu({ name, version, checksum })
		.then((source) => std.patch(source, patches));
};

export type Arg = std.autotools.Arg;

export const build = (...args: std.Args<Arg>) =>
	std.autotools.build({ source: source() }, ...args);

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
