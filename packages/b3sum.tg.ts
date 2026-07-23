import { cargo } from "rust" with { source: "./rust" };
import * as std from "std" with { source: "./std" };

export const metadata = {
	homepage: "https://github.com/BLAKE3-team/BLAKE3",
	license: "CC0-1.0",
	name: "b3sum",
	repository: "https://github.com/BLAKE3-team/BLAKE3",
	version: "1.8.5",
	tag: "b3sum/1.8.5",
	provides: {
		binaries: ["b3sum"],
	},
};

export function source() {
	const { version } = metadata;
	const checksum =
		"sha256:220bd81286e2a0585beac66d41ac3f4c2c33ae8a4e339fc88cf22d5e00514fe9";
	const owner = "BLAKE3-team";
	const repo = "blake3";
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		source: "tag",
		tag: version,
	});
}

export type Arg = cargo.Arg;

export function build(...args: std.Args<Arg>) {
	return cargo.build({ source: source(), manifestSubdir: "b3sum" }, ...args);
}

export default build;

export async function test() {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
}
