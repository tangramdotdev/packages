import * as node from "nodejs" with { path: "../nodejs" };
import * as std from "std" with { path: "../std" };
import { $ } from "std" with { path: "../std" };

import packageLock from "./package-lock.json" with { type: "file" };

export const metadata = {
	home: "https://eslint.org",
	license: "MIT",
	name: "eslint",
	repository: "https://github.com/eslint/eslint",
	version: "9.1.1",
};

export const source = tg.target(async () => {
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
});

export type Arg = {
	env?: std.env.Arg;
	host?: string;
	nodejs?: node.Arg;
	source?: tg.Directory;
};

export const default_ = tg.target(async (...args: std.Args<Arg>) => {
	const {
		nodejs = {},
		source: source_,
		...rest
	} = await std.args.apply<Arg>(...args);
	const phases = { build: tg.Mutation.unset() };

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

export default default_;

export const test = tg.target(async () => {
	return await $`
			echo "Checking that we can run eslint." | tee $OUTPUT
			echo "$(eslint --version)" | tee -a $OUTPUT
		`.env(default_());
});
