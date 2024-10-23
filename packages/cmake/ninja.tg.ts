import * as std from "std" with { path: "../std" };
import * as cmake from "./tangram.ts";

export const metadata = {
	homepage: "https://ninja-build.org/",
	license: "Apache-2.0",
	name: "ninja",
	repository: "https://github.com/ninja-build/ninja",
	version: "1.12.1",
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:821bdff48a3f683bc4bb3b6f0b5fe7b2d647cf65d52aeb63328c91a6c6df285a";
	const owner = "ninja-build";
	const repo = name;
	const tag = `v${version}`;
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		source: "tag",
		tag,
	});
};

export type Arg = {
	build?: string;
	cmake?: cmake.BuildArg;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = tg.target(async (...args: std.Args<Arg>) => {
	const {
		build: build_,
		cmake: cmakeArg = {},
		host: host_,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);
	const host = host_ ?? (await std.triple.host());
	const build = build_ ?? host;

	const configure = {
		args: ["-DCMAKE_BUILD_TYPE=Release", "-DBUILD_TESTING=OFF"],
	};

	const result = cmake.build(
		{
			...(await std.triple.rotate({ build, host })),
			generator: "Unix Makefiles",
			phases: { configure },
			sdk,
			source: source_ ?? source(),
		},
		cmakeArg,
	);

	return result;
});

export default build;

export const test = tg.target(async () => {
	await std.assert.pkg({ packageDir: build(), binaries: ["ninja"],
		metadata, });
	return true;
});
