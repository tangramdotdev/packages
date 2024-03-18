import * as std from "../../tangram.tg.ts";

export let metadata = {
	name: "bc",
	version: "6.6.0",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let owner = "gavinhoward";
	let repo = name;
	let tag = version;
	let compressionFormat = ".xz" as const;
	let checksum =
		"sha256:309ef0faebf149376aa69446a496fac13c3ff483a100a51d9c67cea1a73b2906";
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
		build: build_,
		env: env_,
		host: host_,
		source: source_,
		...rest
	} = arg ?? {};

	let host = await tg.Triple.host(host_);
	let build = build_ ? tg.triple(build_) : host;

	let sourceDir = source_ ?? source();

	// Define phases
	let configure = {
		args: ["--disable-nls", "--disable-man-pages", "--opt=3"],
	};

	// Define environment.
	let ccCommand = build.os == "darwin" ? "cc -D_DARWIN_C_SOURCE" : "cc";
	let env = [env_, std.utils.env(arg), { CC: ccCommand }];

	let output = std.utils.buildUtil(
		{
			...rest,
			...tg.Triple.rotate({ build, host }),
			buildInTree: true,
			env,
			opt: "3",
			phases: { configure },
			source: sourceDir,
		},
		autotools,
	);

	return output;
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
		binaries: ["bc"],
		metadata,
	});
	return directory;
});
