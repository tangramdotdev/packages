import * as std from "../tangram.tg.ts";
import { buildUtil, prerequisites } from "../utils.tg.ts";

export let metadata = {
	name: "gawk",
	version: "5.2.2",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let compressionFormat = ".xz" as const;
	let checksum =
		"sha256:3c1fce1446b4cbee1cd273bd7ec64bc87d89f61537471cd3e05e33a965a250e9";
	return std.download.fromGnu({ name, version, compressionFormat, checksum });
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

	let host = host_ ? tg.triple(host_) : await tg.Triple.host();
	let build = build_ ? tg.triple(build_) : host;

	let configure = {
		args: ["--disable-dependency-tracking", "--disable-rpath"],
	};

	let env: tg.Unresolved<Array<std.env.Arg>> = [env_];
	if (bootstrapMode) {
		env.push(prerequisites({ host }));
	}

	let output = buildUtil(
		{
			...rest,
			...tg.Triple.rotate({ build, host }),
			bootstrapMode,
			env,
			phases: { configure },
			source: source_ ?? source(),
			wrapBashScriptPaths: ["bin/gawkbug"],
		},
		autotools,
	);

	return output;
});

export default build;

import * as bootstrap from "../bootstrap.tg.ts";
export let test = tg.target(async () => {
	let host = bootstrap.toolchainTriple(await tg.Triple.host());
	let bootstrapMode = true;
	let sdk = std.sdk({ host, bootstrapMode });
	let directory = build({ host, bootstrapMode, env: sdk });
	await std.assert.pkg({
		bootstrapMode,
		directory,
		binaries: ["gawk"],
		metadata,
	});
	return directory;
});
