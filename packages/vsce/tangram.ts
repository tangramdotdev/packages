import * as node from "nodejs" with { path: "../nodejs" };
import * as std from "std" with { path: "../std" };
import { $ } from "std" with { path: "../std" };

import packageLock from "./package-lock.json" with { type: "file" };

export const metadata = {
	homepage: "https://code.visualstudio.com",
	license: "MIT",
	name: "vsce",
	repository: "https://github.com/microsoft/vscode-vsce",
	version: "2.15.0",
};

export const source = tg.target(() => {
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
	nodejs?: tg.MaybeNestedArray<node.Arg>;
	source?: tg.Directory;
};

export const build = tg.target(async (arg?: Arg) => {
	const { nodejs = [], source: source_, ...rest } = arg ?? {};

	return node.build(
		{
			...rest,
			source: source_ ?? source(),
			packageLock,
		},
		nodejs,
	);
});

export default build;

export const test = tg.target(async () => {
	return await $`
			echo "Checking that we can run vsce." | tee $OUTPUT
			vsce --version | tee -a $OUTPUT
		`.env(build());
});