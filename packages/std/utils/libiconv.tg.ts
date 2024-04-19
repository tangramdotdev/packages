import * as std from "../tangram.tg.ts";
import { buildUtil, prerequisites } from "../utils.tg.ts";

export let metadata = {
	name: "libiconv",
	version: "1.17",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:8f74213b56238c85a50a5329f77e06198771e70dd9a739779f4c02f65d971313";
	return std.download.fromGnu({ name, version, checksum });
});

type Arg = std.sdk.BuildEnvArg & {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	source?: tg.Directory;
	usePrerequisites?: boolean;
};

export let build = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build: build_,
		env: env_,
		host: host_,
		source: source_,
		usePrerequisites = true,
		...rest
	} = arg ?? {};

	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;

	let configure = {
		args: ["--disable-dependency-tracking"],
	};

	let env: tg.Unresolved<Array<std.env.Arg>> = [env_];
	if (usePrerequisites) {
		env.push(prerequisites(host));
	}

	let output = buildUtil(
		{
			...rest,
			...std.triple.rotate({ build, host }),
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
	let host = await bootstrap.toolchainTriple(await std.triple.host());
	let sdkArg = await bootstrap.sdk.arg(host);
	await std.assert.pkg({
		buildFunction: build,
		metadata,
		libraries: [{ name: "iconv", staticlib: false }],
		sdk: sdkArg,
	});
	return true;
});
