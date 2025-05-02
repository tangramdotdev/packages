import * as std from "../tangram.ts";

export const metadata = {
	name: "m4",
	version: "1.4.19",
};

export const source = tg.command(() => {
	const { name, version } = metadata;
	const checksum =
		"sha256:63aede5c6d33b6d9b13511cd0be2cac046f2e70fd0a07aa9573a04a82783af96";
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
	const { build, env: env_, host, sdk, source: source_ } = arg ?? {};

	const configure = {
		args: ["--disable-dependency-tracking"],
	};

	const env = std.env.arg(
		{ CFLAGS: tg.Mutation.suffix("-std=gnu17", " ") },
		env_,
	);

	const output = std.utils.autotoolsInternal({
		...(await std.triple.rotate({ build, host })),
		env,
		fortifySource: 2,
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
	const sdkArg = await bootstrap.sdk.arg(host);
	// FIXME
	// await std.assert.pkg({ buildFn: build, binaries: ["m4"], metadata });
	return true;
});
