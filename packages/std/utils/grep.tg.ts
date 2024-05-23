import * as std from "../tangram.tg.ts";
import { buildUtil, prerequisites } from "../utils.tg.ts";

export let metadata = {
	name: "grep",
	version: "3.11",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:1db2aedde89d0dea42b16d9528f894c8d15dae4e190b59aecc78f5a951276eab";
	return std.download.fromGnu({
		name,
		version,
		compressionFormat: "xz",
		checksum,
	});
});

export type Arg = {
	build?: string | undefined;
	env?: std.env.Arg;
	host?: string | undefined;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let build = tg.target(async (arg?: Arg) => {
	let {
		build: build_,
		env: env_,
		host: host_,
		sdk,
		source: source_,
	} = arg ?? {};

	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;

	let configure = {
		args: [
			"--disable-dependency-tracking",
			"--disable-perl-regexp",
			"--disable-nls",
			"--disable-rpath",
		],
	};

	let env = std.env.arg(env_, prerequisites(host));

	let output = buildUtil({
		...std.triple.rotate({ build, host }),
		env,
		phases: { configure },
		sdk,
		source: source_ ?? source(),
		wrapBashScriptPaths: ["bin/egrep", "bin/fgrep"],
	});

	return output;
});

export default build;

import * as bootstrap from "../bootstrap.tg.ts";
export let test = tg.target(async () => {
	let host = await bootstrap.toolchainTriple(await std.triple.host());
	let sdkArg = await bootstrap.sdk.arg(host);
	await std.assert.pkg({
		buildFunction: build,
		binaries: ["grep"],
		metadata,
		sdk: sdkArg,
	});
	return true;
});
