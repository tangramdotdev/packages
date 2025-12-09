import * as std from "std" with { local: "./std" };
import * as cmake from "cmake" with { local: "./cmake" };

export const metadata = {
	homepage: "http://lloyd.github.com/yajl",
	license: "ISC",
	name: "yajl",
	repository: "https://github.com/lloyd/yajl",
	version: "2.1.0",
	tag: "yajl/2.1.0",
	provides: {
		binaries: ["json_reformat", "json_verify"],
		libraries: [
			{ name: "yajl", dylib: true, staticlib: false },
			{ name: "yajl_s", dylib: false, staticlib: true },
		],
	},
};

export const source = async (): Promise<tg.Directory> => {
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
		build,
		cmake: cmakeArg = {},
		env,
		host,
		sdk,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

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
};

export default build;

export const test = async () => {
	const spec = {
		...std.assert.defaultSpec(metadata),
		binaries: std.assert.allBinaries(metadata.provides.binaries, {
			testArgs: ["--help"],
			snapshot: "usage:",
		}),
	};
	return await std.assert.pkg(build, spec);
};
