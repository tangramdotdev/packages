import { cargo } from "rust" with { source: "./rust" };
import * as std from "std" with { source: "./std" };
import * as zlib from "zlib-ng" with { source: "./zlib-ng.tg.ts" };

export const metadata = {
	homepage: "https://dandavison.github.io/delta/",
	license: "MIT",
	name: "delta",
	repository: "https://github.com/dandavison/delta",
	version: "0.19.2",
	tag: "delta/0.19.2",
	provides: {
		binaries: ["delta"],
	},
};

export function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:f59b86f8c8dda4d76a3ba34b8553777a20c3b461646917d8e480fac6531bba9f";
	const owner = "dandavison";
	const repo = name;
	const tag = version;
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		source: "tag",
		tag,
	});
}

export function deps() {
	return std.deps({
		zlib: zlib.build,
	});
}

export type Arg = cargo.Arg & std.deps.Arg<typeof deps>;

export function build(...args: tg.Args<Arg>) {
	return cargo.build({ deps, source: source() }, ...args);
}

export default build;

export async function test() {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
}
