import * as node from "nodejs" with { local: "../nodejs.tg.ts" };
import * as std from "std" with { local: "../std" };

import packageLock from "./package-lock.json" with { type: "file" };

export const metadata = {
	homepage: "https://code.visualstudio.com",
	license: "MIT",
	name: "vsce",
	repository: "https://github.com/microsoft/vscode-vsce",
	version: "2.15.0",
	tag: "vsce/2.15.0",
	provides: {
		binaries: ["vsce"],
	},
};

export const source = () => {
	const { version } = metadata;
	const checksum =
		"sha256:07fbf5f5e2a03ed5d424166fad8a2a05ed8d74c7a5ff46b17690f1de286278f3";
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
};

export type Arg = {
	env?: std.env.Arg;
	host?: string;
	nodejs?: Omit<node.Arg, "deps">;
	source?: tg.Directory;
};

export const build = async (...args: std.Args<Arg>) => {
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
};

export default build;

export const test = async () => {
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
};
