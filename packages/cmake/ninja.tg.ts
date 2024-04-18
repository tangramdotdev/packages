import * as std from "tg:std" with { path: "../std" };
import * as cmake from "./tangram.tg.ts";

export let metadata = {
	homepage: "https://ninja-build.org/",
	license: "Apache-2.0",
	name: "ninja",
	repository: "https://github.com/ninja-build/ninja",
	version: "1.12.0",
};

export let source = () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:8b2c86cd483dc7fcb7975c5ec7329135d210099a89bc7db0590a07b0bbfe49a5";
	let owner = "ninja-build";
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
		args: ["-DCMAKE_BUILD_TYPE=Release", "-DBUILD_TESTING=OFF"],
	};

	let result = cmake.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			generator: "Unix Makefiles",
			phases: { configure },
			source: source_ ?? source(),
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
