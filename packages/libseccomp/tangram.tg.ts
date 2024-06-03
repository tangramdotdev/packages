import * as gperf from "tg:gperf" with { path: "../gperf" };
import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://github.com/seccomp/libseccomp",
	license: "LGPLv2.1",
	name: "libseccomp",
	repository: "https://github.com/seccomp/libseccomp",
	version: "2.5.5",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let owner = "seccomp";
	let repo = name;
	let tag = `v${version}`;
	let checksum =
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
		gperf: gperf.Arg;
	};
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let build = tg.target(async (...args: std.Args<Arg>) => {
	let {
		autotools = {},
		build,
		dependencies: { gperf: gperfArg = {} } = {},
		env: env_,
		host,
		source: source_,
		...rest
	} = await std.args.apply<Arg>(...args);

	let configure = {
		args: ["--disable-dependency-tracking"],
	};

	let env = std.env.arg(gperf.build(gperfArg), env_);

	return std.autotools.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			env,
			phases: { configure },
			source: source_ ?? source(),
		},
		autotools,
	);
});

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: build,
		libraries: ["seccomp"],
	});
	return true;
});
