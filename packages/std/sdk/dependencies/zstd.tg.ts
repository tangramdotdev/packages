import * as std from "../../tangram.tg.ts";

export let metadata = {
	name: "zstd",
	version: "1.5.6",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:4aa8dd1c1115c0fd6b6b66c35c7f6ce7bd58cc1dfd3e4f175b45b39e84b14352";
	let owner = "facebook";
	let repo = name;
	let tag = `v${version}`;
	return std.download.fromGithub({
		checksum,
		compressionFormat: "zst",
		owner,
		repo,
		source: "release",
		tag,
		version,
	});
});

export type Arg = {
	build?: string | undefined;
	env?: std.env.Arg;
	host?: string | undefined;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let build = tg.target(async (arg?: Arg) => {
	let { build, env: env_, host, sdk, source: source_ } = arg ?? {};

	let sourceDir = source_ ?? source();

	let install = tg`make install PREFIX=$OUTPUT`;
	let phases = { install };

	let env = std.env.arg(env_, std.utils.env({ build, host, sdk }));

	let result = std.autotools.build({
		...std.triple.rotate({ build, host }),
		buildInTree: true,
		env,
		phases: { phases, order: ["prepare", "build", "install"] },
		prefixArg: "none",
		sdk,
		source: sourceDir,
	});

	return result;
});

export default build;

import * as bootstrap from "../../bootstrap.tg.ts";
export let test = tg.target(async () => {
	let host = await bootstrap.toolchainTriple(await std.triple.host());
	let sdkArg = await bootstrap.sdk.arg(host);
	await std.assert.pkg({
		metadata,
		buildFunction: build,
		libraries: ["zstd"],
		sdk: sdkArg,
	});
	return true;
});
