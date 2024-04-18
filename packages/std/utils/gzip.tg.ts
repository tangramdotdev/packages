import * as std from "../tangram.tg.ts";
import { buildUtil, prerequisites } from "../utils.tg.ts";

export let metadata = {
	name: "gzip",
	version: "1.13",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:7454eb6935db17c6655576c2e1b0fabefd38b4d0936e0f87f48cd062ce91a057";
	return std.download.fromGnu({
		name,
		version,
		compressionFormat: "xz",
		checksum,
	});
});

type Arg = std.sdk.BuildEnvArg & {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	source?: tg.Directory;
};

export let build = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build: build_,
		env: env_,
		host: host_,
		source: source_,
		...rest
	} = arg ?? {};

	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;

	let configure = {
		args: ["--disable-dependency-tracking"],
	};

	let env = [env_, prerequisites(host)];

	let output = buildUtil(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			env,
			phases: { configure },
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
		},
		autotools,
	);

	return output;
});

export default build;

import * as bootstrap from "../bootstrap.tg.ts";
export let test = tg.target(async () => {
	let host = await bootstrap.toolchainTriple(await std.triple.host());
	let sdkArg = await bootstrap.sdk.arg(host);
	let directory = build({ host, sdk: sdkArg });
	await std.assert.pkg({
		directory,
		binaries: ["gzip"],
		metadata,
		sdk: sdkArg,
	});
	return directory;
});
