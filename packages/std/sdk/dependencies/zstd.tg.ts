import * as std from "../../tangram.tg.ts";

export let metadata = {
	name: "zstd",
	version: "1.5.5",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let compressionFormat = ".zst" as const;
	let checksum =
		"sha256:ce264bca60eb2f0e99e4508cffd0d4d19dd362e84244d7fc941e79fa69ccf673";
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

	let env = [env_, std.utils.env(arg)];

	let result = std.autotools.build({
		...rest,
		...tg.Triple.rotate({ build, host }),
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
	let host = bootstrap.toolchainTriple(await tg.Triple.host());
	let bootstrapMode = true;
	let sdk = std.sdk({ host, bootstrapMode });
	let directory = build({ host, bootstrapMode, env: sdk });
	await std.assert.pkg({
		directory,
		libs: ["zstd"],
	});
	return directory;
});
