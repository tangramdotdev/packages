import * as std from "std" with { local: "./std" };
import * as cmake from "cmake" with { local: "./cmake" };

export const metadata = {
	homepage: "https://github.com/google/brotli",
	license: "MIT",
	name: "brotli",
	repository: "https://github.com/google/brotli",
	version: "1.2.0",
	tag: "brotli/1.2.0",
	provides: {
		binaries: ["brotli"],
		libraries: ["brotlicommon", "brotlidec", "brotlienc"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:816c96e8e8f193b40151dad7e8ff37b1221d019dbcb9c35cd3fadbfe6477dfec";
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

export type Arg = cmake.Arg;

export const build = async (...args: std.Args<Arg>) => {
	let output = await cmake.build(
		{
			source: source(),
			phases: {
				configure: {
					args: ["-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_INSTALL_LIBDIR=lib"],
				},
			},
		},
		...args,
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
	let env = {};
	if (std.triple.os(std.triple.host()) === "linux") {
		env = { LD_LIBRARY_PATH: await tg`${build()}/lib` };
	}
	const spec: std.assert.PackageSpec = {
		...std.assert.defaultSpec(metadata),
		env,
		libraries: std.assert.allLibraries(
			["brotlicommon", "brotlidec", "brotlienc"],
			{
				dylib: true,
				staticlib: false,
			},
		),
	};
	return await std.assert.pkg(build, spec);
};
