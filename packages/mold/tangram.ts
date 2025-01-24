import * as std from "std" with { path: "../std" };
import * as cmake from "cmake" with { path: "../cmake" };
import * as pkgConfig from "pkg-config" with { path: "../pkg-config" };
import * as zstd from "zstd" with { path: "../zstd" };

export const metadata = {
	homepage: "https://github.com/rui314/mold",
	hostPlatforms: ["aarch64-linux", "x86_64-linux"],
	license: "MIT",
	name: "mold",
	repository: "https://github.com/rui314/mold",
	version: "2.36.0",
};

export const source = tg.target(() => {
	const { name, version } = metadata;
	const checksum =
		"sha256:3f57fe75535500ecce7a80fa1ba33675830b7d7deb1e5ee9a737e2bc43cdb1c7";
	const owner = "rui314";
	const repo = name;
	const tag = `v${version}`;
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		source: "tag",
		tag,
	});
});

export type Arg = {
	cmake?: cmake.BuildArg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = tg.target(async (...args: std.Args<Arg>) => {
	const {
		cmake: cmake_ = {},
		build,
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	std.assert.supportedHost(host, metadata);

	const configure = {
		args: ["-DCMAKE_BUILD_TYPE=Release"],
	};

	const deps = [
		pkgConfig.build({ build, host: build }),
		zstd.build({ build, host }),
	];
	const env = std.env.arg(...deps, env_);

	const result = cmake.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			phases: { configure },
			sdk,
			source: source_ ?? source(),
		},
		cmake_,
	);

	return result;
});

export default build;

export const test = tg.target(async () => {
	await std.assert.pkg({ buildFn: build, binaries: ["mold"], metadata });
	return true;
});
