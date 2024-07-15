import * as std from "tg:std" with { path: "../std" };
import * as cmake from "tg:cmake" with { path: "../cmake" };
import * as pkgconfig from "tg:pkg-config" with { path: "../pkgconfig" };
import * as zstd from "tg:zstd" with { path: "../zstd" };

export let metadata = {
	homepage: "https://github.com/rui314/mold",
	license: "MIT",
	name: "mold",
	repository: "https://github.com/rui314/mold",
	version: "2.32.1",
};

export let source = () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:f3c9a527d884c635834fe7d79b3de959b00783bf9446280ea274d996f0335825";
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
		build,
		env: env_,
		host,
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
