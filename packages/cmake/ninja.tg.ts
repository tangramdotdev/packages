import * as std from "std" with { local: "../std" };
import * as cmake from "./tangram.ts";

export const metadata = {
	homepage: "https://ninja-build.org/",
	license: "Apache-2.0",
	name: "ninja",
	repository: "https://github.com/ninja-build/ninja",
	version: "1.13.1",
	provides: {
		binaries: ["ninja"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:f0055ad0369bf2e372955ba55128d000cfcc21777057806015b45e4accbebf23";
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

export const build = async (...args: std.Args<Arg>) => {
	const {
		build: build_,
		cmake: cmakeArg = {},
		host: host_,
		sdk,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);
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
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
