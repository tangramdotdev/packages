import * as std from "../../tangram.tg.ts";
import m4 from "./m4.tg.ts";
import make from "./make.tg.ts";

export let metadata = {
	name: "bison",
	version: "3.8.2",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let compressionFormat = ".xz" as const;
	let checksum =
		"sha256:9bba0214ccf7f1079c5d59210045227bcf619519840ebfa80cd3849cff5a5bf2";
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
		args: [
			"--disable-dependency-tracking",
			"--disable-nls",
			"--disable-rpath",
			"--enable-relocatable",
		],
	};

	let dependencies = [m4(arg), make(arg)];
	let env = [std.utils.env(arg), ...dependencies, env_];

	let output = std.utils.buildUtil(
		{
			...rest,
			...std.Triple.rotate({ build, host }),
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

export let test = tg.target(async () => {
	await std.assert.pkg({
		directory: build({ sdk: { bootstrapMode: true } }),
		binaries: ["bison"],
		metadata,
	});
	return true;
});
