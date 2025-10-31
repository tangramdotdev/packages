import * as node from "nodejs" with { local: "../nodejs" };
import * as std from "std" with { local: "../std" };

import packageLock from "./package-lock.json" with { type: "file" };

export const metadata = {
	home: "https://eslint.org",
	license: "MIT",
	name: "eslint",
	repository: "https://github.com/eslint/eslint",
	version: "9.1.1",
	tag: "eslint/9.1.1",
	provides: {
		binaries: ["eslint"],
	},
};

export const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:4f39cb81c3540cbb5e0ccbbb7afff672fec31ac835b1f0be9bbf353083c61b38";
	const owner = name;
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

export type Arg = {
	env?: std.env.Arg;
	host?: string;
	nodejs?: node.Arg;
	source?: tg.Directory;
};

export const build = async (...args: std.Args<Arg>) => {
	const {
		nodejs = {},
		source: source_,
		...rest
	} = await std.packages.applyArgs<Arg>(...args);

	// Build the binaries provided by eslint.
	return node.build(
		{
			...rest,
			packageLock,
			source: source_ ?? source(),
		},
		nodejs,
	);
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
