import * as std from "../../tangram.tg.ts";

export let metadata = {
	name: "zstd",
	version: "1.5.6",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let compressionFormat = ".zst" as const;
	let checksum =
		"sha256:4aa8dd1c1115c0fd6b6b66c35c7f6ce7bd58cc1dfd3e4f175b45b39e84b14352";
	let owner = "facebook";
	let repo = name;
	let tag = `v${version}`;
	return std.download.fromGithub({
		checksum,
		compressionFormat,
		owner,
		repo,
		tag,
		release: true,
		version,
	});
});

type Arg = std.sdk.BuildEnvArg & {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	source?: tg.Directory;
};

export let build = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build,
		env: env_,
		host,
		source: source_,
		...rest
	} = arg ?? {};

	let sourceDir = source_ ?? source();

	let install = tg`make install PREFIX=$OUTPUT`;
	let phases = { install };

	let env = [env_, std.utils.env({ ...rest, build, env: env_, host })];

	let result = std.autotools.build({
		...rest,
		...std.triple.rotate({ build, host }),
		buildInTree: true,
		env,
		phases: { phases, order: ["prepare", "build", "install"] },
		prefixArg: "none",
		source: sourceDir,
	});

	return result;
});

export default build;

import * as bootstrap from "../../bootstrap.tg.ts";
export let test = tg.target(async () => {
	let host = bootstrap.toolchainTriple(await std.triple.host());
	let bootstrapMode = true;
	let sdk = std.sdk({ host, bootstrapMode });
	let directory = build({ host, bootstrapMode, env: sdk });
	await std.assert.pkg({
		bootstrapMode,
		directory,
		libs: ["zstd"],
	});
	return directory;
});
