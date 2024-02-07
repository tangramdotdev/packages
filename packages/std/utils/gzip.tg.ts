import * as std from "../tangram.tg.ts";
import { buildUtil, prerequisites } from "../utils.tg.ts";

export let metadata = {
	name: "gzip",
	version: "1.12",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let compressionFormat = ".xz" as const;
	let checksum =
		"sha256:ce5e03e519f637e1f814011ace35c4f87b33c0bbabeec35baf5fbd3479e91956";
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

	let host = host_ ? std.triple(host_) : await std.Triple.host();
	let build = build_ ? std.triple(build_) : host;

	let configure = {
		args: ["--disable-dependency-tracking"],
	};

	let env: tg.Unresolved<Array<std.env.Arg>> = [];
	if (bootstrapMode) {
		env.push(prerequisites({ host }));
	}
	env.push(env_);

	let output = buildUtil(
		{
			...rest,
			...std.Triple.rotate({ build, host }),
			bootstrapMode,
			env,
			phases: { configure },
			source: source_ ?? source(),
			wrapBashScriptPaths: [
				"bin/gunzip",
				"bin/gzexe",
				"bin/uncompress",
				"bin/zcat",
				"bin/zcmp",
				"bin/zdiff",
				"bin/zegrep",
				"bin/zfgrep",
				"bin/zforce",
				"bin/zgrep",
				"bin/zmore",
				"bin/znew",
			],
		},
		autotools,
	);

	return output;
});

export default build;

import * as bootstrap from "../bootstrap.tg.ts";
export let test = tg.target(async () => {
	let host = bootstrap.toolchainTriple(await std.Triple.host());
	let bootstrapMode = true;
	let sdk = std.sdk({ host, bootstrapMode });
	let directory = build({ host, bootstrapMode, env: sdk });
	await std.assert.pkg({
		directory,
		binaries: ["gzip"],
		metadata,
	});
	return directory;
});
