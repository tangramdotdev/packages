import * as std from "std" with { local: "../std" };
import * as cmake from "./tangram.ts";

export const metadata = {
	homepage: "https://ninja-build.org/",
	license: "Apache-2.0",
	name: "ninja",
	repository: "https://github.com/ninja-build/ninja",
	version: "1.13.1",
	tag: "ninja/1.13.1",
	provides: {
		binaries: ["ninja"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:f0055ad0369bf2e372955ba55128d000cfcc21777057806015b45e4accbebf23";
	const owner = "ninja-build";
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

export type Arg = cmake.BuildArg;

export const build = (...args: std.Args<Arg>) =>
	cmake.build(
		{
			source: source(),
			generator: "Unix Makefiles",
			phases: {
				configure: {
					args: ["-DCMAKE_BUILD_TYPE=Release", "-DBUILD_TESTING=OFF"],
				},
			},
		},
		...args,
	);

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
