import * as std from "../../tangram.tg.ts";

export let metadata = {
	homepage: "https://www.mpfr.org",
	name: "mpfr",
	version: "4.2.1",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
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

export let build = tg.target(async (arg?: Arg) => {
	let { build: build_, env, host: host_, sdk, source: source_ } = arg ?? {};

	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;

	let configure = {
		args: ["--disable-dependency-tracking"],
	};

	let output = await std.utils.buildUtil({
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
export let test = tg.target(async () => {
	let host = await bootstrap.toolchainTriple(await std.triple.host());
	let sdk = await bootstrap.sdk.arg(host);
	return await build({ host, sdk });
});
