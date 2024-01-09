import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.tg.ts";
import { buildUtil } from "../utils.tg.ts";

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

export let test = tg.target(async () => {
	await std.assert.pkg({
		directory: build({ sdk: { bootstrapMode: true } }),
		binaries: ["gzip"],
		metadata,
	});
	return true;
});
