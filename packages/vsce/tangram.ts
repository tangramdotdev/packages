import * as node from "nodejs" with { local: "../nodejs.tg.ts" };
import * as std from "std" with { local: "../std" };

import packageLock from "./package-lock.json" with { type: "file" };

export const metadata = {
	homepage: "https://code.visualstudio.com",
	license: "MIT",
	name: "vsce",
	repository: "https://github.com/microsoft/vscode-vsce",
	version: "3.7.1",
	tag: "vsce/3.7.1",
	provides: {
		binaries: ["vsce"],
	},
};

export const source = () => {
	const { version } = metadata;
	const checksum =
		"sha256:761b176487de3e3091383e4fb0d210e4c3a95657afdcbad8fb0c79b7a89cf700";
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
