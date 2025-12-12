import { cargo } from "rust" with { local: "./rust" };
import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://github.com/sharkdp/hyperfine",
	license: "Apache-2.0, MIT",
	name: "hyperfine",
	repository: "https://github.com/sharkdp/hyperfine",
	version: "1.18.0",
	tag: "hyperfine/1.18.0",
	provides: {
		binaries: ["hyperfine"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:fea7b92922117ed04b9c84bb9998026264346768804f66baa40743c5528bed6b";
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
};

export type Arg = cargo.Arg;

export const build = (...args: std.Args<Arg>) =>
	cargo.build({ source: source() }, ...args);

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
