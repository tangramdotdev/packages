import { cargo } from "rust" with { source: "./rust" };
import * as std from "std" with { source: "./std" };

export const metadata = {
	homepage: "https://www.nushell.sh/",
	license: "MIT",
	name: "nushell",
	repository: "https://github.com/nushell/nushell",
	version: "0.111.0",
	tag: "nushell/0.111.0",
	provides: {
		binaries: ["nu"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:e3a7980bb5532016036d9fdbbe0a2acc5a73f9549d1842ff6c8c0de2a6d1ddbe";
	const owner = name;
	const repo = name;
	const tag = version;
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
