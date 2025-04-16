import * as node from "nodejs" with { path: "../nodejs" };
import * as std from "std" with { path: "../std" };

import packageLock from "./package-lock.json" with { type: "file" };

export const metadata = {
	homepage: "https://code.visualstudio.com",
	license: "MIT",
	name: "vsce",
	repository: "https://github.com/microsoft/vscode-vsce",
	version: "2.15.0",
	provides: {
		binaries: ["vsce"],
	},
};

export const source = tg.command(() => {
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
});

export type Arg = {
	env?: std.env.Arg;
	host?: string;
	nodejs?: node.Arg;
	source?: tg.Directory;
};

export const build = tg.command(async (...args: std.Args<Arg>) => {
	const {
		env,
		host,
		nodejs = {},
		source: source_,
	} = await std.args.apply<Arg>(...args);

	return node.build(
		{
			env,
			host,
			source: source_ ?? source(),
			packageLock,
		},
		nodejs,
	);
});

export default build;

export const run = tg.command(async (...args: Array<tg.Value>) => {
	const dir = await build.build();
	return await tg.run({ executable: tg.symlink(tg`${dir}/bin/vsce`), args });
});

export const test = tg.command(async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
});
