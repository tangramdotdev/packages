import { cargo } from "rust" with { source: "./rust" };
import * as std from "std" with { source: "./std" };

export const metadata = {
	homepage: "https://github.com/sharkdp/hyperfine",
	license: "Apache-2.0, MIT",
	name: "hyperfine",
	repository: "https://github.com/sharkdp/hyperfine",
	version: "1.20.0",
	tag: "hyperfine/1.20.0",
	provides: {
		binaries: ["hyperfine"],
	},
};

export function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:f90c3b096af568438be7da52336784635a962c9822f10f98e5ad11ae8c7f5c64";
	const owner = "sharkdp";
	const repo = name;
	const tag = `v${version}`;
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		source: "tag",
		tag,
	});
}

export type Arg = cargo.Arg;

export function build(...args: std.Args<Arg>) {
	return cargo.build({ source: source() }, ...args);
}

export default build;

export async function test() {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
}
