import * as std from "../tangram.tg.ts";
import * as cmake from "./cmake.tg.ts";

export let metadata = {
	name: "ninja",
	version: "1.11.1",
};

export let source = () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:31747ae633213f1eda3842686f83c2aa1412e0f5691d1c14dbbcc67fe7400cea";
	let owner = "ninja-build";
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

export let ninja = async (arg?: Arg) => {
	let {
		autotools = [],
		build: build_,
		host: host_,
		source: source_,
		...rest
	} = arg ?? {};
	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;

	let configure = {
		args: ["-DCMAKE_BUILD_TYPE=Release"],
	};

	let result = cmake.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			phases: { configure },
			source: source_ ?? source(),
			useNinja: false,
		},
		autotools,
	);

	return result;
};

export default ninja;

export let test = tg.target(async () => {
	let directory = ninja();
	await std.assert.pkg({
		directory,
		binaries: ["ninja"],
		metadata,
	});
	return directory;
});
