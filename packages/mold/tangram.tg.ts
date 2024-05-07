import * as std from "tg:std" with { path: "../std" };
import * as cmake from "tg:cmake" with { path: "../cmake" };
import pkgconfig from "tg:pkgconfig" with { path: "../pkgconfig" };
import zstd from "tg:zstd" with { path: "../zstd" };

export let metadata = {
	homepage: "https://github.com/rui314/mold",
	license: "MIT",
	name: "mold",
	repository: "https://github.com/rui314/mold",
	version: "2.31.0",
};

export let source = () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:3dc3af83a5d22a4b29971bfad17261851d426961c665480e2ca294e5c74aa1e5";
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
	cmake?: tg.MaybeNestedArray<cmake.BuildArg>;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};
export let mold = async (arg?: Arg) => {
	let {
		cmake: cmake_ = [],
		build: build_,
		env: env_,
		host: host_,
		source: source_,
		...rest
	} = arg ?? {};
	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;

	let configure = {
		args: ["-DCMAKE_BUILD_TYPE=Release"],
	};

	let deps = [
		pkgconfig({ ...rest, build, env: env_, host }),
		zstd({ ...rest, build, env: env_, host }),
	];
	let env = [...deps, env_];

	let result = cmake.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			env,
			phases: { configure },
			source: source_ ?? source(),
		},
		cmake_,
	);

	return result;
};

export default mold;

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: mold,
		binaries: ["mold"],
		metadata,
	});
	return true;
});
