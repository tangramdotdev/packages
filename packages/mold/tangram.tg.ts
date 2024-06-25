import * as std from "tg:std" with { path: "../std" };
import * as cmake from "tg:cmake" with { path: "../cmake" };
import * as pkgconfig from "tg:pkg-config" with { path: "../pkgconfig" };
import * as zstd from "tg:zstd" with { path: "../zstd" };

export let metadata = {
	homepage: "https://github.com/rui314/mold",
	license: "MIT",
	name: "mold",
	repository: "https://github.com/rui314/mold",
	version: "2.32.0",
};

export let source = () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:4b7e4146ea0f52be9adae8b417399f3676a041e65b55e3f25f088120d30a320b";
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

type Arg = {
	cmake?: cmake.BuildArg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let build = tg.target(async (...args: std.Args<Arg>) => {
	let {
		cmake: cmake_ = {},
		build: build_,
		env: env_,
		host: host_,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);
	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;

	let configure = {
		args: ["-DCMAKE_BUILD_TYPE=Release"],
	};

	let deps = [
		pkgconfig.build({ ...rest, build, env: env_, host }),
		zstd.build({ ...rest, build, env: env_, host }),
	];
	let env = [...deps, env_];

	let result = cmake.build(
		{
			...rest,
			...(await std.triple.rotate({ build, host })),
			env: std.env.arg(env),
			phases: { configure },
			sdk,
			source: source_ ?? source(),
		},
		cmake_,
	);

	return result;
});

export default build;

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: build,
		binaries: ["mold"],
		metadata,
	});
	return true;
});
