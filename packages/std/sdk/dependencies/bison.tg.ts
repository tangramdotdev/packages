import * as std from "../../tangram.tg.ts";
import m4 from "./m4.tg.ts";

export let metadata = {
	name: "bison",
	version: "3.8.2",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:9bba0214ccf7f1079c5d59210045227bcf619519840ebfa80cd3849cff5a5bf2";
	return std.download.fromGnu({
		name,
		version,
		compressionFormat: "xz",
		checksum,
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
		args: [
			"--disable-dependency-tracking",
			"--disable-nls",
			"--disable-rpath",
			"--enable-relocatable",
		],
	};

	let dependencies = [
		std.utils.env({ ...rest, build, host }),
		m4({ ...rest, build, host }),
	];
	let env = [env_, ...dependencies];

	let output = std.utils.buildUtil(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			env,
			phases: { configure },
			source: source_ ?? source(),
			wrapBashScriptPaths: ["bin/yacc"],
		},
		autotools,
	);

	return output;
});

export default build;

import * as bootstrap from "../../bootstrap.tg.ts";
export let test = tg.target(async () => {
	let host = await bootstrap.toolchainTriple(await std.triple.host());
	let sdkArg = await bootstrap.sdk.arg(host);
	let directory = build({ host, sdk: sdkArg });
	await std.assert.pkg({
		directory,
		binaries: ["bison"],
		metadata,
		sdk: sdkArg,
	});
	return directory;
});
