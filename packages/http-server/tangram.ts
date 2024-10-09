import * as nodejs from "nodejs" with { path: "../nodejs" };
import * as std from "std" with { path: "../std" };
import { $ } from "std" with { path: "../std" };

import packageLock from "./package-lock.json" with { type: "file" };

export const metadata = {
	homepage: "https://github.com/http-party/http-server",
	license: "MIT",
	name: "http-server",
	repository: "https://github.com/http-party/http-server",
	version: "14.1.1",
};

export const source = tg.target(() => {
	const { name, version } = metadata;
	const checksum =
		"sha256:55eabb10a644d593f447daa1872d29cdb4a231b32c86db75c7db96a3027e6564";
	const owner = "http-party";
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
	nodejs?: tg.MaybeNestedArray<nodejs.Arg>;
	source?: tg.Directory;
};

export const build = tg.target(async (arg?: Arg) => {
	const { nodejs: nodeArgs = [], source: source_, ...rest } = arg ?? {};

	return nodejs.build(
		{
			...rest,
			source: source_ ?? source(),
			packageLock,
		},
		nodeArgs,
	);
});

export default build;

export const test = tg.target(async () => {
	return await $`
			http-server --version | tee $OUTPUT
		`.env(build());
});