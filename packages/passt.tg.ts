import * as std from "std" with { source: "./std" };

export const metadata = {
	homepage: "https://passt.top/",
	hostPlatforms: ["aarch64-linux", "x86_64-linux"],
	license: "GPL-2.0-or-later AND BSD-3-Clause",
	name: "passt",
	repository: "https://passt.top/passt",
	version: "2026_10_02.cba3570",
	tag: "passt/2026_10_02.cba3570",
	provides: {
		binaries: ["passt", "pasta"],
	},
};

export function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:aa75616cc43925f0bd6c05bcfbbaecd77397c03d7bd23591b34ef535be5dfcdc";
	return std
		.download({
			url: `https://passt.top/${name}/snapshot/${name}-${version}.tar.xz`,
			checksum,
			mode: "extract",
		})
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
}

export type Arg = std.autotools.Arg;

export async function build(...args: tg.Args<Arg>) {
	const arg = await std.autotools.arg(
		{
			buildInTree: true,
			source: source(),
			phases: {
				configure: tg.Mutation.unset(),
				build: { args: [`VERSION=${metadata.version}`] },
				install: { args: [tg`prefix=${tg.output}`] },
			},
		},
		...args,
	);
	std.assert.supportedHost(arg.host, metadata);
	return std.autotools.build(arg);
}

export default build;

export async function test() {
	// pasta is passt run under the name pasta, so check that it selects pasta's mode.
	const spec = {
		...std.assert.defaultSpec(metadata),
		binaries: [
			std.assert.displaysVersion("passt", metadata.version),
			{
				name: "pasta",
				testArgs: ["--help"],
				snapshot: "run the given command",
			},
		],
	};
	return await std.assert.pkg(build, spec);
}
