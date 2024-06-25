import * as std from "../tangram.tg.ts";
import { buildUtil, prerequisites } from "../utils.tg.ts";

export let metadata = {
	name: "gawk",
	version: "5.3.0",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:ca9c16d3d11d0ff8c69d79dc0b47267e1329a69b39b799895604ed447d3ca90b";
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
	sdk?: std.sdk.Arg | boolean;
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
		args: ["--disable-dependency-tracking", "--disable-rpath"],
	};

	let env = std.env.arg(env_, prerequisites(host));

	let output = buildUtil({
		...(await std.triple.rotate({ build, host })),
		env,
		phases: { configure },
		sdk,
		source: source_ ?? source(),
		wrapBashScriptPaths: ["bin/gawkbug"],
	});

	return output;
});

export default build;

import * as bootstrap from "../bootstrap.tg.ts";
export let test = tg.target(async () => {
	let host = await bootstrap.toolchainTriple(await std.triple.host());
	let sdk = await bootstrap.sdk(host);
	return build({ host, sdk: false, env: sdk });
});
