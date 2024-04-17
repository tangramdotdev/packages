import * as std from "tg:std" with { path: "../std" };
import * as cmake from "tg:cmake" with { path: "../cmake" };
import pkgconfig from "tg:pkgconfig" with { path: "../pkgconfig" };
import zstd from "tg:zstd" with { path: "../zstd" };

export let metadata = {
	homepage: "https://github.com/rui314/mold",
	license: "MIT",
	name: "mold",
	repository: "https://github.com/rui314/mold",
	version: "2.30.0",
};

export let source = () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:6e5178ccafe828fdb4ba0dd841d083ff6004d3cb41e56485143eb64c716345fd";
	let owner = "rui314";
	let repo = name;
	let tag = `v${version}`;
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		tag,
		version,
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
	let directory = mold();
	await std.assert.pkg({
		directory,
		binaries: ["mold"],
		metadata,
	});
	return directory;
});
