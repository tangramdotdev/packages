import * as std from "std" with { path: "../std" };
import * as cmake from "cmake" with { path: "../cmake" };
import * as zstd from "zstd" with { path: "../zstd" };

export const metadata = {
	homepage: "https://github.com/rui314/mold",
	hostPlatforms: ["aarch64-linux", "x86_64-linux"],
	license: "MIT",
	name: "mold",
	repository: "https://github.com/rui314/mold",
	version: "2.38.1",
	provides: {
		binaries: ["mold"],
	},
};

export const source = tg.command(() => {
	const { name, version } = metadata;
	const checksum =
		"sha256:14bfb259fd7d0a1fdce9b66f8ed2dd0b134d15019cb359699646afeee1f18118";
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

export const build = tg.command(async (...args: std.Args<Arg>) => {
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

	const deps = [zstd.build({ build, host })];
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

export const run = tg.command(async (...args: Array<tg.Value>) => {
	const dir = await build.build();
	return await tg.run({ executable: tg.symlink(tg`${dir}/bin/mold`), args });
});

export const test = tg.command(async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
});
