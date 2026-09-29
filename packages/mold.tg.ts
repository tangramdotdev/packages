import * as std from "std" with { source: "./std" };
import * as cmake from "cmake" with { source: "./cmake" };
import * as zstd from "zstd" with { source: "./zstd.tg.ts" };

export const metadata = {
	homepage: "https://github.com/rui314/mold",
	hostPlatforms: ["aarch64-linux", "x86_64-linux"],
	license: "MIT",
	name: "mold",
	repository: "https://github.com/rui314/mold",
	version: "2.42.1",
	tag: "mold/2.42.1",
	provides: {
		binaries: ["mold"],
	},
};

export function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:0580221bfdad7148ceeafd0ad3c1c7b3ca9e66b45950405230cc3f81a205c816";
	const owner = "rui314";
	const repo = name;
	const tag = `v${version}`;
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		source: "tag",
		tag,
	});
}

export function deps() {
	return std.deps({
		zstd: {
			build: zstd.build,
			kind: "runtime",
			when: { hostOs: "linux" },
		},
	});
}

export type Arg = cmake.Arg & std.deps.Arg<typeof deps>;

export async function build(...args: tg.Args<Arg>) {
	const resolved = await cmake.arg(
		{
			source: source(),
			deps,
			phases: {
				configure: {
					args: ["-DCMAKE_BUILD_TYPE=Release"],
				},
			},
		},
		...args,
	);
	std.assert.supportedHost(resolved.host, metadata);

	return cmake.build(resolved);
}

export default build;

export async function test() {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
}
