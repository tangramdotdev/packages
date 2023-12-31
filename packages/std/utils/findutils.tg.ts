import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.tg.ts";
import { buildUtil } from "../utils.tg.ts";

export let metadata = {
	name: "findutils",
	version: "4.9.0",
};

export let source = tg.target(async (os: tg.System.Os) => {
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
	let host = await std.Triple.host(host_);
	let build = build_ ? std.triple(build_) : host;
	let os = build.os;

	let wrapBashScriptPaths: Array<string> | undefined =
		os === "linux" ? ["bin/updatedb"] : undefined;

	let configure = {
		args: ["--disable-dependency-tracking", "--disable-rpath"],
	};

	let env = [bootstrap.make.build(arg), env_];

	let output = buildUtil(
		{
			...rest,
			...std.Triple.rotate({ build, host }),
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
	await std.assert.pkg({
		directory: build({ sdk: { bootstrapMode: true } }),
		binaries: ["find", "locate", "xargs"],
		metadata,
	});
	return true;
});
