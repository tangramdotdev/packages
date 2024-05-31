import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.tg.ts";
import { buildUtil, prerequisites } from "../utils.tg.ts";
import disableLocatePatch from "./findutils-disable-locate.diff" with {
	type: "file",
};

export let metadata = {
	name: "findutils",
	version: "4.9.0",
};

export let source = tg.target(async (os: string) => {
	let { name, version } = metadata;
	let checksum =
		"sha256:a2bfb8c09d436770edc59f50fa483e785b161a3b7b9d547573cb08065fd462fe";
	let source = await std.download.fromGnu({
		name,
		version,
		compressionFormat: "xz",
		checksum,
	});

	// On macos, don't build locate/updatedb.
	if (os === "darwin") {
		source = await bootstrap.patch(source, disableLocatePatch);
	}
	return source;
});

export type Arg = {
	build?: string | undefined;
	env?: std.env.Arg;
	host?: string | undefined;
	sdk?: std.sdk.Arg | boolean;
	source?: tg.Directory;
};

export let build = tg.target(async (arg?: Arg) => {
	let {
		build: build_,
		env: env_,
		host: host_,
		sdk,
		source: source_,
	} = arg ?? {};
	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;
	let os = std.triple.os(build);

	let wrapBashScriptPaths: Array<string> | undefined =
		os === "linux" ? ["bin/updatedb"] : undefined;

	let configure = {
		args: ["--disable-dependency-tracking", "--disable-rpath"],
	};

	let env = std.env.arg(env_, prerequisites(host));

	let output = buildUtil({
		...std.triple.rotate({ build, host }),
		env,
		phases: { configure },
		sdk,
		source: source_ ?? source(os),
		wrapBashScriptPaths,
	});

	return output;
});

export default build;

export let test = tg.target(async () => {
	let host = await bootstrap.toolchainTriple(await std.triple.host());
	let sdkArg = await bootstrap.sdk.arg(host);
	await std.assert.pkg({
		buildFunction: build,
		binaries: ["find", "xargs"],
		metadata,
		sdk: sdkArg,
	});
	return true;
});
