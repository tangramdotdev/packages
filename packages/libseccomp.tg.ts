import * as gperf from "gperf" with { source: "./gperf.tg.ts" };
import * as std from "std" with { source: "./std" };

export const metadata = {
	homepage: "https://github.com/seccomp/libseccomp",
	hostPlatforms: ["aarch64-linux", "x86_64-linux"],
	license: "LGPLv2.1",
	name: "libseccomp",
	repository: "https://github.com/seccomp/libseccomp",
	version: "2.6.1",
	tag: "libseccomp/2.6.1",
	provides: {
		binaries: ["scmp_sys_resolver"],
		libraries: ["seccomp"],
	},
};

export async function source() {
	const { name, version } = metadata;
	const owner = "seccomp";
	const repo = name;
	const tag = `v${version}`;
	const checksum =
		"sha256:501f66c667225d53791b97e1d7cf85ab764c297d04881f60f38f451c4b0ee1be";
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		source: "release",
		tag,
		version,
	});
}

export function deps() {
	return std.deps({
		gperf: { build: gperf.build, kind: "buildtime" },
	});
}

export type Arg = std.autotools.Arg & std.deps.Arg<typeof deps>;

export async function build(...args: tg.Args<Arg>) {
	const arg = await std.autotools.arg(
		{
			source: source(),
			deps,
			phases: {
				configure: { args: ["--disable-dependency-tracking"] },
			},
		},
		...args,
	);
	std.assert.supportedHost(arg.host, metadata);
	return std.autotools.build(arg);
}

export default build;

export async function test() {
	const spec = {
		...std.assert.defaultSpec(metadata),
		binaries: std.assert.allBinaries(metadata.provides.binaries, {
			testArgs: ["-h"],
			snapshot: "usage:",
			exitOnErr: false,
		}),
	};
	return await std.assert.pkg(build, spec);
}
