import { cargo } from "rust" with { local: "./rust" };
import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://www.nushell.sh/",
	license: "MIT",
	name: "nushell",
	repository: "https://github.com/nushell/nushell",
	version: "0.109.1",
	tag: "nushell/0.109.1",
	provides: {
		binaries: ["nu"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:53d4611113a17ed3a29b0c81ea981d546a40dafca77fdcd9af7a7629ceabf48f";
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
