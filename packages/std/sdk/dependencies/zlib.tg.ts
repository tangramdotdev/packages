import * as std from "../../tangram.tg.ts";

export let metadata = {
	name: "zlib",
	version: "1.3.1",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let extension = ".tar.xz";
	let packageArchive = std.download.packageArchive({
		extension,
		name,
		version,
	});

	let checksum =
		"sha256:38ef96b8dfe510d42707d9c781877914792541133e1870841463bfa73f883e32";
	let url = `https://zlib.net/${packageArchive}`;
	return await std
		.download({ url, checksum })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

export type Arg = {
	build?: string | undefined;
	env?: std.env.Arg;
	host?: string | undefined;
	sdk?: std.sdk.Arg | boolean;
	source?: tg.Directory;
};

export let build = tg.target(async (arg?: Arg) => {
	let { build, env, host, sdk, source: source_ } = arg ?? {};

	let output = std.utils.buildUtil({
		...(await std.triple.rotate({ build, host })),
		env,
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
		libraries: ["z"],
		sdk: sdkArg,
	});
	return true;
});
