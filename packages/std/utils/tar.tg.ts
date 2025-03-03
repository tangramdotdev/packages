import * as std from "../tangram.ts";
import { buildUtil, prerequisites } from "../utils.tg.ts";
import libiconv from "./libiconv.tg.ts";

export const metadata = {
	name: "tar",
	version: "1.35",
};

export const source = tg.command(() => {
	const { name, version } = metadata;
	const checksum =
		"sha256:4d62ff37342ec7aed748535323930c7cf94acf71c3591882b26a7ea50f3edc16";
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

	const dependencies: tg.Unresolved<std.Args<std.env.Arg>> = [
		prerequisites(host),
	];
	const additionalEnv = {};

	const configure = {
		args: ["--disable-dependency-tracking"],
	};

	const env = std.env.arg(env_, ...dependencies, additionalEnv);

	const output = buildUtil({
		...(await std.triple.rotate({ build, host })),
		env,
		phases: { configure },
		sdk,
		source: source_ ?? source(),
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
