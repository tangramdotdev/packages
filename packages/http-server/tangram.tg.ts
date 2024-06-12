import * as nodejs from "tg:nodejs" with { path: "../nodejs" };
import * as std from "tg:std" with { path: "../std" };
import { $ } from "tg:std" with { path: "../std" };

import packageLock from "./package-lock.json" with { type: "file" };

export let metadata = {
	name: "http-server",
	version: "14.1.1",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:55eabb10a644d593f447daa1872d29cdb4a231b32c86db75c7db96a3027e6564";
	let owner = "http-party";
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
	nodejs?: tg.MaybeNestedArray<nodejs.Arg>;
	source?: tg.Directory;
};

export let build = tg.target(async (arg?: Arg) => {
	let { nodejs: nodeArgs = [], source: source_, ...rest } = arg ?? {};

	return nodejs.build(
		{
			...rest,
			source: source_ ?? source(),
			packageLock,
		},
		nodeArgs,
	);
});

export let test = tg.target(async () => {
	return await $`
			http-server --version | tee $OUTPUT
		`.env(build());
});
