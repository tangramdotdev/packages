import * as std from "../../tangram.tg.ts";
import make from "./make.tg.ts";

export let metadata = {
	name: "patch",
	version: "2.7.6",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let compressionFormat = ".xz" as const;
	let checksum =
		"sha256:ac610bda97abe0d9f6b7c963255a11dcb196c25e337c61f94e4778d632f1d8fd";
	return std.download.fromGnu({ name, version, compressionFormat, checksum });
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
			source: source_ ?? source(),
		},
		autotools,
	);

	return output;
});

export default build;

import * as bootstrap from "../../bootstrap.tg.ts";
export let test = tg.target(async () => {
	let host = bootstrap.toolchainTriple(await std.Triple.host());
	await std.assert.pkg({
		directory: build({ host, sdk: { bootstrapMode: true } }),
		binaries: ["patch"],
		metadata,
	});
	return true;
});
