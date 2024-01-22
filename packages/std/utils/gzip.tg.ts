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

	let env = [prerequisites({ host }), env_];

	let output = buildUtil(
		{
			...rest,
			...std.Triple.rotate({ build, host }),
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
	await std.assert.pkg({
		directory: build({ host, sdk: { bootstrapMode: true } }),
		binaries: ["gzip"],
		metadata,
	});
	return true;
});
