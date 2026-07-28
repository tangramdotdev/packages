import * as node from "nodejs" with { source: "../nodejs.tg.ts" };
import * as std from "std" with { source: "../std" };

import packageLock from "./package-lock.json" with { type: "file" };

export const metadata = {
	homepage: "https://eslint.org",
	license: "MIT",
	name: "eslint",
	repository: "https://github.com/eslint/eslint",
	version: "10.7.0",
	tag: "eslint/10.7.0",
	provides: {
		binaries: ["eslint"],
	},
};

export async function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:be765b80bdb3537132aac8dfd9c62db0d2de11fb5eea7a941ce80b8aaa32b4bd";
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
}

export type Arg = {
	env?: std.env.Arg;
	host?: string;
	nodejs?: Omit<node.Arg, "deps">;
	source?: tg.Directory;
};

export async function build(...args: tg.Args<Arg>) {
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
}

export default build;

export async function test() {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
}
