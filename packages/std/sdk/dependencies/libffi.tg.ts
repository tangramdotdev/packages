import * as std from "../../tangram.tg.ts";
import make from "./make.tg.ts";

export let metadata = {
	name: "libffi",
	version: "3.4.4",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:d66c56ad259a82cf2a9dfc408b32bf5da52371500b84745f7fb8b645712df676";
	let owner = name;
	let repo = name;
	let tag = `v${version}`;
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		tag,
		release: true,
		version,
	});
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

	return std.utils.buildUtil(
		{
			...rest,
			...std.Triple.rotate({ build, host }),
			env,
			phases: { configure },
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default build;

export let test = tg.target(async () => {
	await std.assert.pkg({
		directory: build({ sdk: { bootstrapMode: true } }),
		libs: ["ffi"],
	});
	return true;
});
