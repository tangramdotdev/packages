import * as nodejs from "nodejs" with { path: "../nodejs" };
import * as std from "std" with { path: "../std" };

import packageLock from "./package-lock.json" with { type: "file" };

export const metadata = {
	homepage: "https://github.com/http-party/http-server",
	license: "MIT",
	name: "http-server",
	repository: "https://github.com/http-party/http-server",
	version: "14.1.1",
	provides: {
		binaries: ["http-server"],
	},
};

export const source = () => {
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
};

export type Arg = {
	build?: string;
	host?: string;
	nodejs?: nodejs.Arg;
	source?: tg.Directory;
};

export const build = async (...args: std.Args<Arg>) => {
	const {
		build,
		host,
		nodejs: nodeArgs = {},
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

	return nodejs.build(
		{
			build,
			host,
			source: source_ ?? source(),
			packageLock,
		},
		nodeArgs,
	);
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
