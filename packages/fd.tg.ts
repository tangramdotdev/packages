import { cargo } from "rust" with { source: "./rust" };
import * as std from "std" with { source: "./std" };

export const metadata = {
	homepage: "https://github.com/sharkdp/fd",
	license: "Apache-2.0, MIT",
	name: "fd",
	repository: "https://github.com/sharkdp/fd",
	version: "10.4.2",
	tag: "fd/10.4.2",
	provides: {
		binaries: ["fd"],
	},
};

export function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:3a7e027af8c8e91c196ac259c703d78cd55c364706ddafbc66d02c326e57a456";
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

export function build(...args: tg.Args<Arg>) {
	return cargo.build({ source: source() }, ...args);
}

export default build;

export async function test() {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
}
