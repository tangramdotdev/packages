import * as std from "../tangram.tg.ts";
import * as cmake from "./cmake.tg.ts";

export let metadata = {
	name: "mold",
	version: "2.4.0",
};

export let source = () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:be65f3d785d32ece7b3204ecaa57810847fdd25c232cf704cbfff2dafb1ac107";
	let owner = "rui314";
	let repo = name;
	let tag = `v${version}`;
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		tag,
		version,
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
		host: host_,
		source: source_,
		...rest
	} = arg ?? {};
	let host = host_ ? tg.triple(host_) : await tg.Triple.host();
	let build = build_ ? tg.triple(build_) : host;

	let configure = {
		args: ["-DCMAKE_BUILD_TYPE=Release"],
	};

	let result = cmake.build(
		{
			...rest,
			...tg.Triple.rotate({ build, host }),
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
