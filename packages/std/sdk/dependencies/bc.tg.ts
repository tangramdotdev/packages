import * as std from "../../tangram.tg.ts";

export let metadata = {
	name: "bc",
	version: "6.7.5",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let unpackFormat = ".tar.xz" as const;
	let packageName = std.download.packageArchive({
		name,
		version,
		unpackFormat,
	});
	let checksum =
		"sha256:c3e02c948d51f3ca9cdb23e011050d2d3a48226c581e0749ed7cbac413ce5461";
	let url = `https://git.gavinhoward.com/gavin/${name}/releases/download/${version}/${packageName}`;
	let outer = tg.Directory.expect(
		await std.download({
			url,
			checksum,
			unpackFormat,
		}),
	);
	return std.directory.unwrap(outer);
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

	let host = await std.triple.host(host_);
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
			...std.triple.rotate({ build, host }),
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
	let host = bootstrap.toolchainTriple(await std.triple.host());
	let bootstrapMode = true;
	let sdk = std.sdk({ host, bootstrapMode });
	let directory = build({ host, bootstrapMode, env: sdk });
	await std.assert.pkg({
		bootstrapMode,
		directory,
		binaries: ["bc"],
		metadata,
	});
	return directory;
});
