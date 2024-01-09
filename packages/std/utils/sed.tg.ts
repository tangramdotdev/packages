import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.tg.ts";
import { buildUtil } from "../utils.tg.ts";

export let metadata = {
	name: "sed",
	version: "4.9",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let compressionFormat = ".xz" as const;
	let checksum =
		"sha256:6e226b732e1cd739464ad6862bd1a1aba42d7982922da7a53519631d24975181";
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

	let env = [bootstrap.make.build(arg), env_];

	let output = buildUtil(
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

export let test = tg.target(async () => {
	await std.assert.pkg({
		directory: build({ sdk: { bootstrapMode: true } }),
		binaries: ["sed"],
		metadata,
	});
	return true;
});
