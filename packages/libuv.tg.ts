import * as cmake from "cmake" with { local: "./cmake" };
import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://libuv.org/",
	license: "MIT",
	name: "libuv",
	repository: "https://github.com/libuv/libuv",
	version: "1.51.0",
	tag: "libuv/1.51.0",
	provides: {
		libraries: ["uv"],
	},
};

export const source = () => {
	const { version } = metadata;
	const checksum =
		"sha256:27e55cf7083913bfb6826ca78cde9de7647cded648d35f24163f2d31bb9f51cd";
	const owner = "libuv";
	const repo = "libuv";
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
		build,
		cmake: cmakeArg = {},
		env,
		host,
		sdk,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

	const configure = {
		args: [
			"-DCMAKE_BUILD_TYPE=Release",
			"-DCMAKE_INSTALL_LIBDIR=lib",
			"-DBUILD_TESTING=OFF",
		],
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
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
