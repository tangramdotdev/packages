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

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	dependencies?: {
		gperf?: std.args.DependencyArg<gperf.Arg>;
	};
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		dependencies: dependencyArgs = {},
		env: env_,
		host,
		sdk,
		source: source_,
		...rest
	} = await std.packages.applyArgs<Arg>(...args);

	std.assert.supportedHost(host, metadata);

	const dependencies = [
		std.env.buildDependency(gperf.build, dependencyArgs.gperf),
	];

	const env = std.env.arg(
		...dependencies.map((dep) =>
			std.env.envArgFromDependency(build, env_, host, sdk, dep),
		),
		env_,
	);

	const configure = {
		args: ["--disable-dependency-tracking"],
	};

	return std.autotools.build(
		{
			...rest,
			...(await std.triple.rotate({ build, host })),
			env,
			phases: { configure },
			source: source_ ?? source(),
		},
		autotools,
	);
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
