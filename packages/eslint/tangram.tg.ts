import * as node from "tg:nodejs" with { path: "../nodejs" };
import * as std from "tg:std" with { path: "../std" };
import { $ } from "tg:std" with { path: "../std" };

import packageLock from "./package-lock.json" with { type: "file" };

export let metadata = {
	home: "https://eslint.org",
	license: "MIT",
	name: "eslint",
	repository: "https://github.com/eslint/eslint",
	version: "9.1.1",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:4f39cb81c3540cbb5e0ccbbb7afff672fec31ac835b1f0be9bbf353083c61b38";
	let owner = name;
	let repo = name;
	let tag = `v${version}`;
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

export let build = tg.target(async (...args: std.Args<Arg>) => {
	let {
		nodejs = {},
		source: source_,
		...rest
	} = await std.args.apply<Arg>(...args);
	let phases = { build: tg.Mutation.unset() };

	// Build the binaries provided by eslint.
	return node.build(
		{
			...rest,
			packageLock,
			phases,
			source: source_ ?? source(),
		},
		nodejs,
	);
});

export let test = tg.target(async () => {
	return await $`
			echo "Checking that we can run eslint." | tee $OUTPUT
			echo "$(eslint --version)" | tee -a $OUTPUT
		`.env(build());
});
