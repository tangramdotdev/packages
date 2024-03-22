import * as std from "../tangram.tg.ts";
import { buildUtil, prerequisites } from "../utils.tg.ts";

let metadata = {
	name: "diffutils",
	version: "3.10",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let compressionFormat = ".xz" as const;
	let checksum =
		"sha256:90e5e93cc724e4ebe12ede80df1634063c7a855692685919bfe60b556c9bd09e";
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

	let host = host_ ? tg.triple(host_) : await std.triple.host();
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
			...std.triple.rotate({ build, host }),
			bootstrapMode,
			env,
			phases: { configure },
			source: source_ ?? source(),
		},
		autotools,
	);

	return output;
});

export default build;

import * as bootstrap from "../bootstrap.tg.ts";
export let test = tg.target(async () => {
	let host = bootstrap.toolchainTriple(await std.triple.host());
	let bootstrapMode = true;
	let sdk = std.sdk({ host, bootstrapMode });
	let directory = await build({ host, bootstrapMode, env: sdk });
	await std.assert.pkg({
		bootstrapMode,
		directory,
		binaries: ["cmp", "diff"],
		metadata,
	});
	return directory;
});
