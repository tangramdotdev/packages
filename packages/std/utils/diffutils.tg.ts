import * as std from "../tangram.ts";
import { buildUtil, prerequisites } from "../utils.tg.ts";

const metadata = {
	name: "diffutils",
	version: "3.10",
};

export const source = tg.command(() => {
	const { name, version } = metadata;
	const checksum =
		"sha256:90e5e93cc724e4ebe12ede80df1634063c7a855692685919bfe60b556c9bd09e";
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
		args: ["--disable-dependency-tracking", "--disable-rpath"],
	};

	const env = std.env.arg(env_, prerequisites(build));

	const output = buildUtil({
		...(await std.triple.rotate({ build, host })),
		env,
		sdk,
		phases: { configure },
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
