import * as std from "../tangram.ts";
import { buildUtil, prerequisites } from "../utils.tg.ts";

export const metadata = {
	name: "gawk",
	version: "5.3.0",
};

export const source = tg.target(() => {
	const { name, version } = metadata;
	const checksum =
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

export const build = tg.target(async (arg?: Arg) => {
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
		args: ["--disable-dependency-tracking", "--disable-rpath"],
	};

	const env = std.env.arg(env_, prerequisites(build));

	const output = buildUtil({
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
export const test = tg.target(async () => {
	const host = await bootstrap.toolchainTriple(await std.triple.host());
	const sdk = await bootstrap.sdk(host);
	return build({ host, sdk: false, env: sdk });
});
