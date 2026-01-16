import * as gperf from "gperf" with { local: "./gperf.tg.ts" };
import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://github.com/seccomp/libseccomp",
	hostPlatforms: ["aarch64-linux", "x86_64-linux"],
	license: "LGPLv2.1",
	name: "libseccomp",
	repository: "https://github.com/seccomp/libseccomp",
	version: "2.5.5",
	tag: "libseccomp/2.5.5",
	provides: {
		binaries: ["scmp_sys_resolver"],
		libraries: ["seccomp"],
	},
};

export const source = async () => {
	const { name, version } = metadata;
	const owner = "seccomp";
	const repo = name;
	const tag = `v${version}`;
	const checksum =
		"sha256:248a2c8a4d9b9858aa6baf52712c34afefcf9c9e94b76dce02c1c9aa25fb3375";
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		source: "release",
		tag,
		version,
	});
};

const deps = () =>
	std.deps({
		gperf: { build: gperf.build, kind: "buildtime" },
	});

export type Arg = std.autotools.Arg & std.deps.Arg<ReturnType<typeof deps>>;

export const build = async (...args: std.Args<Arg>) => {
	const arg = await std.autotools.arg(
		{
			source: source(),
			deps: deps(),
			phases: {
				configure: { args: ["--disable-dependency-tracking"] },
			},
		},
		...args,
	);
	std.assert.supportedHost(arg.host, metadata);
	return std.autotools.build(arg);
};

export default build;

export const test = async () => {
	const spec = {
		...std.assert.defaultSpec(metadata),
		binaries: std.assert.allBinaries(metadata.provides.binaries, {
			testArgs: ["-h"],
			snapshot: "usage:",
		}),
	};
	return await std.assert.pkg(build, spec);
};
