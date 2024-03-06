import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.tg.ts";
import { buildUtil, prerequisites } from "../utils.tg.ts";

export let metadata = {
	name: "xz",
	version: "5.4.5",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let compressionFormat = ".xz" as const;
	let checksum =
		"sha256:da9dec6c12cf2ecf269c31ab65b5de18e8e52b96f35d5bcd08c12b43e6878803";
	let owner = "tukaani-project";
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
		bootstrapMode,
		build: build_,
		env: env_,
		host: host_,
		source: source_,
		...rest
	} = arg ?? {};
	let host = await tg.Triple.host(host_);
	let build = build_ ? tg.triple(build_) : host;

	let configure = {
		args: [
			"--disable-debug",
			"--disable-dependency-tracking",
			"--disable-nls",
			"--disable-silent-rules",
		],
	};

	let env: tg.Unresolved<std.env.Arg> = [env_, { MAKEFLAGS: "--silent" }];
	if (bootstrapMode) {
		env.push(prerequisites({ host }));
	}
	env.push(env_);

	let output = await buildUtil(
		{
			...rest,
			...tg.Triple.rotate({ build, host }),
			bootstrapMode,
			env,
			phases: { configure },
			source: source_ ?? source(),
			wrapBashScriptPaths: [
				"bin/xzdiff",
				"bin/xzgrep",
				"bin/xzless",
				"bin/xzmore",
			],
		},
		autotools,
	);

	let bins = ["lzmadec", "lzmainfo", "xz", "xzdec"];
	let libDir = tg.Directory.expect(await output.get("lib"));
	for (let bin of bins) {
		let unwrappedBin = tg.File.expect(await output.get(`bin/${bin}`));
		let wrappedBin = std.wrap(unwrappedBin, {
			libraryPaths: [libDir],
			sdk: arg?.sdk,
		});
		output = await tg.directory(output, { [`bin/${bin}`]: wrappedBin });
	}
	return output;
});

export default build;

export let test = tg.target(async () => {
	let host = bootstrap.toolchainTriple(await tg.Triple.host());
	let bootstrapMode = true;
	let sdk = std.sdk({ host, bootstrapMode });
	let xzArtifact = build({ host, bootstrapMode, env: sdk });
	await std.assert.pkg({
		directory: xzArtifact,
		binaries: ["xz"],
		libs: ["lzma"],
		metadata,
	});
	return xzArtifact;
});