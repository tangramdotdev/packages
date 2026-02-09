import { cargo } from "rust" with { local: "./rust" };
import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://www.nushell.sh/",
	license: "MIT",
	name: "nushell",
	repository: "https://github.com/nushell/nushell",
	version: "0.110.0",
	tag: "nushell/0.110.0",
	provides: {
		binaries: ["nu"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:e4c95f743cea3d985ab90e03fd35707a46eef926d407ed363f994155c1ca5055";
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
