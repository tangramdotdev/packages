import * as std from "std" with { source: "./std" };

export const metadata = {
	homepage: "https://github.com/strace/strace",
	hostPlatforms: ["aarch64-linux", "x86_64-linux"],
	name: "strace",
	license: "https://github.com/strace/strace/blob/master/COPYING",
	repository: "https://github.com/strace/strace",
	version: "7.1",
	tag: "strace/7.1",
	provides: {
		binaries: ["strace"],
	},
};

export async function source() {
	const { name, version } = metadata;
	const owner = name;
	const repo = name;
	const tag = `v${version}`;
	const checksum =
		"sha256:81743ecf2a5b44186b2f5038afdc8beda7e5c70aed15b4fbfbcc6e9ece24490f";
	return std.download.fromGithub({
		checksum,
		compression: "xz",
		owner,
		repo,
		tag,
		source: "release",
		version,
	});
}

export type Arg = std.autotools.Arg;

export async function build(...args: std.Args<Arg>) {
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
}

export default build;

export async function test() {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
}
