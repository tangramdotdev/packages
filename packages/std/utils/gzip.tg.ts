import * as std from "../tangram.ts";
import { autotoolsInternal, prerequisites } from "../utils.tg.ts";

export const metadata = {
	name: "gzip",
	version: "1.13",
};

export const source = tg.command(() => {
	const { name, version } = metadata;
	const checksum =
		"sha256:7454eb6935db17c6655576c2e1b0fabefd38b4d0936e0f87f48cd062ce91a057";
	return std.download.fromGnu({
		name,
		version,
		compression: "xz",
		checksum,
	});
});

export type Arg = {
	build?: string | undefined;
	env?: std.env.Arg;
	host?: string | undefined;
	sdk?: std.sdk.Arg | boolean;
	source?: tg.Directory;
};

export const build = tg.command(async (arg?: Arg) => {
	const {
		build: build_,
		env: env_,
		host: host_,
		sdk,
		source: source_,
	} = arg ?? {};

	const host = host_ ?? (await std.triple.host());
	const build = build_ ?? host;

	const configure = {
		args: ["--disable-dependency-tracking"],
	};

	const env = std.env.arg(env_, prerequisites(build));

	const output = autotoolsInternal({
		...(await std.triple.rotate({ build, host })),
		env,
		phases: { configure },
		sdk,
		source: source_ ?? source(),
		wrapBashScriptPaths: [
			"bin/gunzip",
			"bin/gzexe",
			"bin/uncompress",
			"bin/zcat",
			"bin/zcmp",
			"bin/zdiff",
			"bin/zegrep",
			"bin/zfgrep",
			"bin/zforce",
			"bin/zgrep",
			"bin/zmore",
			"bin/znew",
		],
	});

	return output;
});

export default build;

import * as bootstrap from "../bootstrap.tg.ts";

export const test = tg.command(async () => {
	const host = await bootstrap.toolchainTriple(await std.triple.host());
	const sdk = await bootstrap.sdk(host);
	return build({ host, sdk: false, env: sdk });
});
