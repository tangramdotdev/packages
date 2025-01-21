import * as std from "std" with { path: "../std" };
import * as cmake from "cmake" with { path: "../cmake" };

export const metadata = {
	homepage: "http://lloyd.github.com/yajl",
	license: "ISC",
	name: "yajl",
	repository: "https://github.com/lloyd/yajl",
	version: "2.1.0",
};

export const source = tg.target(async (): Promise<tg.Directory> => {
	const { name, version } = metadata;
	const checksum =
		"sha256:3fb73364a5a30efe615046d07e6db9d09fd2b41c763c5f7d3bfb121cd5c5ac5a";
	const owner = "containers";
	const repo = name;
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		source: "tag",
		tag: version,
	});
});

export type Arg = {
	build?: string;
	cmake?: cmake.BuildArg;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const default_ = tg.target(async (...args: std.Args<Arg>) => {
	const {
		build,
		cmake: cmakeArg = {},
		env,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	const configure = {
		args: ["-DCMAKE_BUILD_TYPE=Release"],
	};

	return cmake.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			phases: { configure },
			sdk,
			source: source_ ?? source(),
		},
		cmakeArg,
	);
});

export default default_;

export const test = tg.target(async () => {
	const hasUsage = (name: string) => {
		return {
			name,
			testArgs: ["--help"],
			testPredicate: (stdout: string) =>
				stdout.toLowerCase().includes("usage:"),
		};
	};
	await std.assert.pkg({
		buildFn: default_,
		binaries: [hasUsage("json_reformat"), hasUsage("json_verify")],
		metadata,
	});
	return true;
});
