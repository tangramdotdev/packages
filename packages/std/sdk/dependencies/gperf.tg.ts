import * as std from "../../tangram.tg.ts";
import make from "./make.tg.ts";

export let metadata = {
	name: "gperf",
	version: "3.1",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:588546b945bba4b70b6a3a616e80b4ab466e3f33024a352fc2198112cdbb3ae2";
	return std.download.fromGnu({ name, version, checksum });
});

type Arg = std.sdk.BuildEnvArg & {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	source?: tg.Directory;
};

export let build = tg.target((arg?: Arg) => {
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

	let env = [std.utils.env(arg), make(arg), env_];

	let output = std.utils.buildUtil(
		{
			...rest,
			...std.Triple.rotate({ build, host }),
			env,
			phases: { configure },
			source: source(),
		},
		autotools,
	);

	return output;
});

export default build;

import * as bootstrap from "../../bootstrap.tg.ts";
export let test = tg.target(async () => {
	let host = bootstrap.toolchainTriple(await std.Triple.host());
	let bootstrapMode = true;
	let sdk = std.sdk({ host, bootstrapMode });
	let directory = build({ host, bootstrapMode, env: sdk });
	await std.assert.pkg({
		directory,
		binaries: ["gperf"],
		metadata,
	});
	return directory;
});
