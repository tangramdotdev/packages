import * as std from "std" with { local: "./std" };
import * as cmake from "cmake" with { local: "./cmake" };

export const metadata = {
	homepage: "https://ninja-build.org/",
	license: "Apache-2.0",
	name: "ninja",
	repository: "https://github.com/ninja-build/ninja",
	version: "1.13.2",
	tag: "ninja/1.13.2",
	provides: {
		binaries: ["ninja"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:974d6b2f4eeefa25625d34da3cb36bdcebe7fbce40f4c16ac0835fd1c0cbae17";
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

export type Arg = cmake.Arg;

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
