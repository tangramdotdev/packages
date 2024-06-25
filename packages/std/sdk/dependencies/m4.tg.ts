import * as std from "../../tangram.tg.ts";

export let metadata = {
	name: "m4",
	version: "1.4.19",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:63aede5c6d33b6d9b13511cd0be2cac046f2e70fd0a07aa9573a04a82783af96";
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
	let { build, env: env_, host, sdk, source: source_ } = arg ?? {};

	let configure = {
		args: ["--disable-dependency-tracking"],
	};

	let env = std.env.arg(env_);

	let output = std.utils.buildUtil({
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
	let sdkArg = await bootstrap.sdk.arg(host);
	await std.assert.pkg({
		buildFunction: build,
		binaries: ["m4"],
		metadata,
		sdk: sdkArg,
	});
	return true;
});
