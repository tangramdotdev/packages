import * as gperf from "gperf" with { path: "../gperf" };
import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://github.com/seccomp/libseccomp",
	hosts: ["aarch64-linux", "x86_64-linux"],
	license: "LGPLv2.1",
	name: "libseccomp",
	repository: "https://github.com/seccomp/libseccomp",
	version: "2.5.5",
};

export const source = tg.target(async () => {
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
});

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	dependencies?: {
		gperf?: gperf.Arg;
	};
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = tg.target(async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		dependencies: { gperf: gperfArg = {} } = {},
		env: env_,
		host,
		sdk,
		source: source_,
		...rest
	} = await std.args.apply<Arg>(...args);

	std.assert.supportedHost(host, metadata);

	const configure = {
		args: ["--disable-dependency-tracking"],
	};

	const env = std.env.arg(
		gperf.build({ build, env: env_, host, sdk }, gperfArg),
		env_,
	);

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
});

export default build;

export const test = tg.target(async () => {
	const hasUsage = (name: string) => {
		return {
			name,
			testArgs: ["-h"],
			testPredicate: (stdout: string) => stdout.includes("usage:"),
		};
	};
	await std.assert.pkg({
		buildFn: build,
		binaries: [hasUsage("scmp_sys_resolver")],
		libraries: ["seccomp"],
		metadata,
	});
	return true;
});
