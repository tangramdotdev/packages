import * as std from "../../tangram.ts";

export const metadata = {
	homepage: "https://www.multiprecision.org",
	name: "mpc",
	version: "1.3.1",
};

export const source = tg.command(() => {
	const { name, version } = metadata;
	const checksum =
		"sha256:ab642492f5cf882b74aa0cb730cd410a81edcdbec895183ce930e706c1c759b8";
	return std.download.fromGnu({ checksum, name, version });
});

export type Arg = {
	build?: string | undefined;
	env?: std.env.Arg;
	host?: string | undefined;
	sdk?: std.sdk.Arg | boolean;
	source?: tg.Directory;
};

export const build = tg.command(async (arg?: Arg) => {
	const { build: build_, env, host: host_, sdk, source: source_ } = arg ?? {};

	const host = host_ ?? (await std.triple.host());
	const build = build_ ?? host;

	const configure = {
		args: ["--disable-dependency-tracking"],
	};

	const output = std.utils.autotoolsInternal({
		...(await std.triple.rotate({ build, host })),
		env,
		phases: { configure },
		sdk,
		source: source_ ?? source(),
	});

	return output;
});

export default build;

import * as bootstrap from "../../bootstrap.tg.ts";

export const test = tg.command(async () => {
	const host = await bootstrap.toolchainTriple(await std.triple.host());
	const sdk = await bootstrap.sdk.arg(host);
	return await build({ host, sdk });
});
