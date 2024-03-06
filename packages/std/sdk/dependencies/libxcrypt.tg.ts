import * as std from "../../tangram.tg.ts";
import perl from "./perl.tg.ts";

export let metadata = {
	name: "libxcrypt",
	version: "4.4.36",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let owner = "besser82";
	let repo = name;
	let tag = `v${version}`;
	let compressionFormat = ".xz" as const;
	let checksum =
		"sha256:e5e1f4caee0a01de2aee26e3138807d6d3ca2b8e67287966d1fefd65e1fd8943";
	return std.download.fromGithub({
		checksum,
		compressionFormat,
		owner,
		release: true,
		repo,
		tag,
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

	let configure = {
		args: ["--disable-dependency-tracking"],
	};
	let phases = { configure };

	let dependencies = [perl(arg)];
	let env = [env_, std.utils.env(arg), ...dependencies];

	return std.autotools.build(
		{
			...rest,
			...tg.Triple.rotate({ build, host }),
			env,
			phases,
			source: source_ ?? source(),
		},
		autotools,
	);
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
		libs: ["crypt"],
	});
	return directory;
});
