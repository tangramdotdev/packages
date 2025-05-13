import * as std from "std" with { path: "../std" };
import * as cmake from "cmake" with { path: "../cmake" };

export const metadata = {
	homepage: "https://github.com/google/brotli",
	license: "MIT",
	name: "brotli",
	repository: "https://github.com/google/brotli",
	version: "1.1.0",
	provides: {
		binaries: ["brotli"],
	},
};

export const source = async (): Promise<tg.Directory> => {
	const { name, version } = metadata;
	const checksum =
		"sha256:e720a6ca29428b803f4ad165371771f5398faba397edf6778837a18599ea13ff";
	const owner = "google";
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
		args: ["-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_INSTALL_LIBDIR=lib"],
	};

	let output = await cmake.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			phases: { configure },
			sdk,
			source: source_ ?? source(),
		},
		cmakeArg,
	);

	const exe = await output.get("bin/brotli").then(tg.File.expect);
	const libDir = await output.get("lib").then(tg.Directory.expect);
	output = await tg.directory(output, {
		["bin/brotli"]: std.wrap(exe, { libraryPaths: [libDir] }),
	});

	return output;
};

export default build;

export const test = async () => {
	// FIXME
	// const dylibOnly = (name: string) => {
	// 	return { name, dylib: true, staticlib: false };
	// };
	// let env = {};
	// if ((await std.triple.host().then(std.triple.os)) === "linux") {
	// 	env = { LD_LIBRARY_PATH: await tg`${build()}/lib` };
	// }
	// await std.assert.pkg({
	// 	buildFn: build,
	// 	binaries: ["brotli"],
	// 	env,
	// 	libraries: ["brotlicommon", "brotlidec", "brotlienc"].map(dylibOnly),
	// 	metadata,
	// });
	// return true;
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
