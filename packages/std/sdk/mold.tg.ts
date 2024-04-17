import * as std from "../tangram.tg.ts";
import * as cmake from "./cmake.tg.ts";
import zstd from "./dependencies/zstd.tg.ts";

export let metadata = {
	name: "mold",
	version: "2.30.0",
};

export let source = () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:6e5178ccafe828fdb4ba0dd841d083ff6004d3cb41e56485143eb64c716345fd";
	let owner = "rui314";
	let repo = name;
	let tag = `v${version}`;
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		source: "tag",
		tag,
	});
};

export type Arg = std.sdk.BuildEnvArg & {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	source?: tg.Directory;
};

export let mold = async (arg?: Arg) => {
	let {
		autotools = [],
		build: build_,
		env: env_,
		host: host_,
		source: source_,
		...rest
	} = arg ?? {};
	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;

	let configure = {
		args: ["-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_INSTALL_LIBDIR=lib"],
	};

	let env = [zstd({ build, host }), env_];

	let result = cmake.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			env,
			phases: { configure },
			source: source_ ?? source(),
		},
		autotools,
	);

	return result;
};

export default mold;

export let test = tg.target(async () => {
	let directory = mold();
	await std.assert.pkg({
		directory,
		binaries: ["mold"],
		metadata,
	});
	return directory;
});
