import * as std from "../../tangram.tg.ts";
import autoconf from "./autoconf.tg.ts";
import bison from "./bison.tg.ts";
import m4 from "./m4.tg.ts";
import make from "./make.tg.ts";
import perl from "./perl.tg.ts";
import zlib from "./zlib.tg.ts";

export let metadata = {
	name: "help2man",
	version: "1.49.3",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let compressionFormat = ".xz" as const;
	let checksum =
		"sha256:4d7e4fdef2eca6afe07a2682151cea78781e0a4e8f9622142d9f70c083a2fd4f";
	return std.download.fromGnu({ name, version, compressionFormat, checksum });
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

	let perlArtifact = await perl(arg);
	let interpreter = tg.symlink({ artifact: perlArtifact, path: "bin/perl" });
	let dependencies = [
		autoconf(arg),
		bison(arg),
		m4(arg),
		make(arg),
		perlArtifact,
		zlib(arg),
	];
	let env = [std.utils.env(arg), ...dependencies, env_];
	let artifact = std.utils.buildUtil(
		{
			...rest,
			...std.Triple.rotate({ build, host }),
			env,
			source: source_ ?? source(),
		},
		autotools,
	);

	let wrappedScript = std.wrap(tg.symlink({ artifact, path: "bin/help2man" }), {
		interpreter: interpreter,
		sdk: arg?.sdk,
	});

	return tg.directory({
		["bin/help2man"]: wrappedScript,
	});
});

export default build;

export let test = tg.target(async () => {
	await std.assert.pkg({
		directory: build({ sdk: { bootstrapMode: true } }),
		binaries: ["help2man"],
		metadata,
	});
	return true;
});
