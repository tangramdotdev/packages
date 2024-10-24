import * as std from "std" with { path: "../std" };
import * as cmake from "cmake" with { path: "../cmake" };
import * as pkgconfig from "pkgconfig" with { path: "../pkgconfig" };
import * as zstd from "zstd" with { path: "../zstd" };

export const metadata = {
	homepage: "https://github.com/rui314/mold",
	license: "MIT",
	name: "mold",
	repository: "https://github.com/rui314/mold",
	version: "2.32.1",
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:f3c9a527d884c635834fe7d79b3de959b00783bf9446280ea274d996f0335825";
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
};

export type Arg = {
	cmake?: cmake.BuildArg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const default_ = tg.target(async (...args: std.Args<Arg>) => {
	const {
		cmake: cmake_ = {},
		build: build_,
		env: env_,
		host: host_,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);
	const host = host_ ?? (await std.triple.host());
	const build = build_ ?? host;

	const configure = {
		args: ["-DCMAKE_BUILD_TYPE=Release"],
	};

	const deps = [
		pkgconfig.default_({ build, host: build }),
		zstd.default_({ build, host }),
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

export default default_;

export const test = tg.target(async () => {
	await std.assert.pkg({
		packageDir: default_(),
		binaries: ["mold"],
		metadata,
	});
	return true;
});
