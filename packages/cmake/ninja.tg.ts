import * as std from "tg:std" with { path: "../std" };
import * as cmake from "./tangram.tg.ts";

export let metadata = {
	homepage: "https://ninja-build.org/",
	license: "Apache-2.0",
	name: "ninja",
	repository: "https://github.com/ninja-build/ninja",
	version: "1.12.1",
};

export let source = () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:821bdff48a3f683bc4bb3b6f0b5fe7b2d647cf65d52aeb63328c91a6c6df285a";
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

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let build = tg.target(async (...args: std.Args<Arg>) => {
	let {
		autotools = {},
		build: build_,
		host: host_,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);
	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;

	let configure = {
		args: ["-DCMAKE_BUILD_TYPE=Release", "-DBUILD_TESTING=OFF"],
	};

	let result = cmake.build(
		{
			...std.triple.rotate({ build, host }),
			generator: "Unix Makefiles",
			phases: { configure },
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);

	return result;
});

export default build;

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: build,
		binaries: ["ninja"],
		metadata,
	});
	return true;
});
