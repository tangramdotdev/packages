import gperf from "tg:gperf" with { path: "../gperf" };
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
		tag,
		release: true,
		version,
	});
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: tg.Triple.Arg;
	env?: std.env.Arg;
	host?: tg.Triple.Arg;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let libseccomp = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build,
		env: env_,
		host,
		source: source_,
		...rest
	} = arg ?? {};

	let configure = {
		args: ["--disable-dependency-tracking"],
	};

	let env = [gperf(arg), env_];

	return std.autotools.build(
		{
			...rest,
			...tg.Triple.rotate({ build, host }),
			env,
			phases: { configure },
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default libseccomp;

export let test = tg.target(async () => {
	let directory = libseccomp();
	await std.assert.pkg({
		directory,
		libs: ["seccomp"],
	});
	return directory;
});
