import * as go from "go" with { source: "./go.tg.ts" };
import * as std from "std" with { source: "./std" };

export const metadata = {
	homepage: "https://junegunn.github.io/fzf/",
	license: "MIT",
	name: "fzf",
	repository: "https://github.com/junegunn/fzf",
	version: "0.74.5",
	tag: "fzf/0.74.5",
	provides: {
		binaries: ["fzf"],
	},
};

export function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:5529d08897b85ae773695787c811ff9c9eeee32419c8a297fa1dbe586ed0a27e";
	const tag = `v${version}`;
	return std.download.fromGithub({
		checksum,
		owner: "junegunn",
		repo: name,
		source: "tag",
		tag,
	});
}

export type Arg = go.Arg;

export function build(...args: tg.Args<Arg>) {
	return go.build({ source: source() }, ...args);
}

export default build;

export async function test() {
	const majorMinor = metadata.version.split(".").slice(0, 2).join(".");
	const spec = {
		...std.assert.defaultSpec(metadata),
		binaries: std.assert.allBinaries(metadata.provides.binaries, {
			snapshot: majorMinor,
		}),
	};
	return await std.assert.pkg(build, spec);
}
