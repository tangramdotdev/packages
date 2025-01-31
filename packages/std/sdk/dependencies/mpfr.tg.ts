import * as std from "../../tangram.ts";

export const metadata = {
	homepage: "https://www.mpfr.org",
	name: "mpfr",
	version: "4.2.1",
};

export const source = tg.command(async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:277807353a6726978996945af13e52829e3abd7a9a5b7fb2793894e18f1fcbb2";
	return std.download.fromGnu({
		checksum,
		name,
		version,
		compressionFormat: "xz",
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
	const { build: build_, env, host: host_, sdk, source: source_ } = arg ?? {};

	const host = host_ ?? (await std.triple.host());
	const build = build_ ?? host;

	const configure = {
		args: ["--disable-dependency-tracking"],
	};

	const output = await std.utils.buildUtil({
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
