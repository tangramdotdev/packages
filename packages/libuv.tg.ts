import * as cmake from "cmake" with { source: "./cmake" };
import * as std from "std" with { source: "./std" };

export const metadata = {
	homepage: "https://libuv.org/",
	license: "MIT",
	name: "libuv",
	repository: "https://github.com/libuv/libuv",
	version: "1.52.1",
	tag: "libuv/1.52.1",
	provides: {
		libraries: ["uv"],
	},
};

export function source() {
	const { version } = metadata;
	const checksum =
		"sha256:478baf2599bfbc882c355288c9cb6f92e0e7dda435fa04031fa5b607cf3f414c";
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
}

export type Arg = cmake.Arg;

export function build(...args: tg.Args<Arg>) {
	return cmake.build(
		{
			source: source(),
			phases: {
				configure: {
					args: ["-DCMAKE_BUILD_TYPE=Release", "-DBUILD_TESTING=OFF"],
				},
			},
		},
		...args,
	);
}

export default build;

export async function test() {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
}
