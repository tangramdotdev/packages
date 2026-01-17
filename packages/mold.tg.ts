import * as std from "std" with { local: "./std" };
import * as cmake from "cmake" with { local: "./cmake" };
import * as zstd from "zstd" with { local: "./zstd.tg.ts" };

export const metadata = {
	homepage: "https://github.com/rui314/mold",
	hostPlatforms: ["aarch64-linux", "x86_64-linux"],
	license: "MIT",
	name: "mold",
	repository: "https://github.com/rui314/mold",
	version: "2.40.2",
	tag: "mold/2.40.2",
	provides: {
		binaries: ["mold"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:28c7976c39e53ee440217b6b9f036a8cf13e3b2f93e8da83e19c66f4fc9a774c";
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
};

export const deps = () =>
	std.deps({
		zstd: {
			build: zstd.build,
			kind: "runtime",
			when: (ctx) => std.triple.os(ctx.host) === "linux",
		},
	});

export type Arg = cmake.Arg & std.deps.Arg<typeof deps>;

export const build = async (...args: std.Args<Arg>) => {
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
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
