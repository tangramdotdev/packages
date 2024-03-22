import perl from "tg:perl" with { path: "../perl" };
import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://github.com/besser82/libxcrypt",
	name: "libxcrypt",
	license: "LGPL-2.1",
	repository: "https://github.com/besser82/libxcrypt",
	version: "4.4.36",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let owner = "besser82";
	let repo = name;
	let tag = `v${version}`;
	let compressionFormat = ".xz" as const;
	let checksum =
		"sha256:e5e1f4caee0a01de2aee26e3138807d6d3ca2b8e67287966d1fefd65e1fd8943";
	return std.download.fromGithub({
		checksum,
		compressionFormat,
		owner,
		release: true,
		repo,
		tag,
		version,
	});
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let build = tg.target(async (arg?: Arg) => {
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
	let phases = { configure };

	let dependencies = [perl(arg)];
	let env = [...dependencies, env_];

	return std.autotools.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			env,
			phases,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default build;

export let test = tg.target(async () => {
	let directory = build();
	await std.assert.pkg({
		directory,
		libs: ["crypt"],
	});
	return directory;
});
