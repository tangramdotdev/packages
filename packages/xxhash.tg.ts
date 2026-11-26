import * as std from "std" with { source: "./std" };

export const metadata = {
	builds: { exports: ["default", "build"] },
	homepage: "https://xxhash.com",
	license: "BSD-2-Clause",
	name: "xxhash",
	repository: "https://github.com/Cyan4973/xxHash",
	version: "0.8.3",
	tag: "xxhash/0.8.3",
	provides: {
		binaries: ["xxhsum"],
		headers: ["xxhash.h"],
		libraries: [{ name: "xxhash", pkgConfigName: "libxxhash" }],
	},
};

export function source() {
	const { version } = metadata;
	const checksum =
		"sha256:aae608dfe8213dfd05d909a57718ef82f30722c392344583d3f39050c7f29a80";
	return std.download.fromGithub({
		checksum,
		owner: "Cyan4973",
		repo: "xxHash",
		source: "tag",
		tag: `v${version}`,
	});
}

export type Arg = std.autotools.Arg;

export function build(...args: tg.Args<Arg>) {
	return std.autotools.build(
		{
			buildInTree: true,
			order: ["prepare", "build", "install", "fixup"],
			phases: {
				build: `make -j"$(nproc)"`,
				install: tg`make install PREFIX=${tg.output}`,
			},
			prefixArg: "none",
			source: source(),
		},
		...args,
	);
}

export default build;

export async function test() {
	const spec = {
		...std.assert.defaultSpec(metadata),
		binaries: std.assert.binaries(metadata.provides.binaries, {
			xxhsum: { testArgs: ["--version"], snapshot: metadata.version },
		}),
	};
	return await std.assert.pkg(build, spec);
}
