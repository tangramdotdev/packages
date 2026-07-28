import * as node from "nodejs" with { source: "../nodejs.tg.ts" };
import * as std from "std" with { source: "../std" };

import packageLock from "./package-lock.json" with { type: "file" };

export const metadata = {
	homepage: "https://code.visualstudio.com",
	license: "MIT",
	name: "vsce",
	repository: "https://github.com/microsoft/vscode-vsce",
	version: "3.9.2",
	tag: "vsce/3.9.2",
	provides: {
		binaries: ["vsce"],
	},
};

export function source() {
	const { version } = metadata;
	const checksum =
		"sha256:96819256dca27c353fa3a06c27ba14979f262d470d9856fa972505f0e4aa1fc1";
	const owner = "microsoft";
	const repo = "vscode-vsce";
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
		env,
		host,
		nodejs = {},
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

	return node.build(
		{
			env,
			host,
			source: source_ ?? source(),
			packageLock,
		},
		nodejs,
	);
}

export default build;

export async function test() {
	const spec = {
		...std.assert.defaultSpec(metadata),
		binaries: [
			{
				name: "vsce",
				testArgs: ["--help"],
				snapshot: "Usage:",
			},
		],
	};
	return await std.assert.pkg(build, spec);
}
