import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.tg.ts";
import { buildUtil, prerequisites } from "../utils.tg.ts";

export let metadata = {
	name: "findutils",
	version: "4.9.0",
};

export let source = tg.target(async (os: string) => {
	let { name, version } = metadata;
	let compressionFormat = ".xz" as const;
	let checksum =
		"sha256:a2bfb8c09d436770edc59f50fa483e785b161a3b7b9d547573cb08065fd462fe";
	let source = await std.download.fromGnu({
		name,
		version,
		compressionFormat,
		checksum,
	});

	// On macos, don't build locate/updatedb.
	if (os === "darwin") {
		let locatePatch = tg.File.expect(
			await tg.include("findutils-disable-locate.diff"),
		);
		source = await bootstrap.patch(source, locatePatch);
	}
	return source;
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
	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;
	let os = std.triple.os(build);

	let wrapBashScriptPaths: Array<string> | undefined =
		os === "linux" ? ["bin/updatedb"] : undefined;

	let configure = {
		args: ["--disable-dependency-tracking", "--disable-rpath"],
	};

	let env = [env_, prerequisites(host)];

	let output = buildUtil(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			env,
			phases: { configure },
			source: source_ ?? source(os),
			wrapBashScriptPaths,
		},
		autotools,
	);

	return output;
});

export default build;

export let test = tg.target(async () => {
	let host = await bootstrap.toolchainTriple(await std.triple.host());
	let sdkArg = await bootstrap.sdk.arg(host);
	let directory = build({ host, sdk: sdkArg });
	await std.assert.pkg({
		directory,
		binaries: ["find", "xargs"],
		metadata,
		sdk: sdkArg,
	});
	return directory;
});
