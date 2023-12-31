import * as bootstrap from "../../bootstrap.tg.ts";
import * as std from "../../tangram.tg.ts";

export let metadata = {
	name: "make",
	version: "4.4.1",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:dd16fb1d67bfab79a72f5e8390735c49e3e8e70b4945a15ab1f81ddb78658fb3";
	return std.download.fromGnu({ name, version, checksum });
});

type Arg = std.sdk.BuildEnvArg & {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	source?: tg.Directory;
};

export let build = tg.target(async (arg?: Arg) => {
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
	let phases = { prepare: "set +e", configure, fixup: "mkdir -p $OUTPUT && cp config.log $OUTPUT/config.log" };

	let env = [std.utils.env(arg), bootstrap.make.build(arg), env_];

	return std.utils.buildUtil(
		{
			...rest,
			...std.Triple.rotate({ build, host }),
			env,
			phases,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default build;

export let test = tg.target(async () => {
	let makeArtifact = await build({ sdk: { bootstrapMode: true } });
	// await std.assert.pkg({
	// 	directory: makeArtifact,
	// 	binaries: ["make"],
	// 	metadata,
	// });
	return makeArtifact;
});
