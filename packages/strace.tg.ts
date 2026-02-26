import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://github.com/strace/strace",
	hostPlatforms: ["aarch64-linux", "x86_64-linux"],
	name: "strace",
	license: "https://github.com/strace/strace/blob/master/COPYING",
	repository: "https://github.com/strace/strace",
	version: "6.19",
	tag: "strace/6.19",
	provides: {
		binaries: ["strace"],
	},
};

export const source = async () => {
	const { name, version } = metadata;
	const owner = name;
	const repo = name;
	const tag = `v${version}`;
	const checksum =
		"sha256:e076c851eec0972486ec842164fdc54547f9d17abd3d1449de8b120f5d299143";
	return std.download.fromGithub({
		checksum,
		compression: "xz",
		owner,
		repo,
		tag,
		source: "release",
		version,
	});
};

export type Arg = std.autotools.Arg;

export const build = async (...args: std.Args<Arg>) => {
	const arg = await std.autotools.arg(
		{
			source: source(),
			phases: {
				configure: { args: ["--enable-mpers=check"] },
			},
		},
		...args,
	);
	std.assert.supportedHost(arg.host, metadata);
	return std.autotools.build(arg);
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
