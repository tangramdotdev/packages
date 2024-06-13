import * as perl from "tg:perl" with { path: "../perl" };
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
		compressionFormat: "xz",
		owner,
		source: "release",
		repo,
		tag,
		version,
	});
});

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		perl?: perl.Arg;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let build = tg.target(async (...args: std.Args<Arg>) => {
	let {
		autotools = {},
		build,
		dependencies: { perl: perlArg = {} } = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	let configure = {
		args: ["--disable-dependency-tracking"],
	};
	let phases = { configure };

	let dependencies = [perl.build(perlArg)];
	let env = std.env.arg(...dependencies, env_);

	return std.autotools.build(
		{
			...std.triple.rotate({ build, host }),
			env,
			phases,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default build;

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: build,
		libraries: ["crypt"],
	});
	return true;
});
