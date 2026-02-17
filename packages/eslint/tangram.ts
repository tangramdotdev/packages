import * as node from "nodejs" with { local: "../nodejs.tg.ts" };
import * as std from "std" with { local: "../std" };

import packageLock from "./package-lock.json" with { type: "file" };

export const metadata = {
	homepage: "https://eslint.org",
	license: "MIT",
	name: "eslint",
	repository: "https://github.com/eslint/eslint",
	version: "10.0.0",
	tag: "eslint/10.0.0",
	provides: {
		binaries: ["eslint"],
	},
};

export const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:465f34c0e6d389957194daced33a5ea65a193559f012c6463218a1d8cd638348";
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
	nodejs?: Omit<node.Arg, "deps">;
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
