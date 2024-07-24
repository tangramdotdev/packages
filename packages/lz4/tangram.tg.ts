import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://lz4.org/",
	license:
		"https://github.com/lz4/lz4/blob/5ff839680134437dbf4678f3d0c7b371d84f4964/LICENSE",
	name: "lz4",
	repository: "https://github.com/lz4/lz4",
	version: "1.10.0",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:537512904744b35e232912055ccf8ec66d768639ff3abe5788d90d792ec5f48b";
	let owner = name;
	let repo = name;
	let tag = `v${version}`;
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
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let build = tg.target(async (...args: std.Args<Arg>) => {
	let {
		autotools = {},
		build,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	let sourceDir = source_ ?? source();

	let install = {
		args: ["prefix=$OUTPUT"],
	};
	let phases = {
		configure: { command: tg.Mutation.unset(), args: tg.Mutation.unset() },
		install,
	};

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			buildInTree: true,
			phases,
			sdk,
			source: sourceDir,
		},
		autotools,
	);
});

export default build;

export let test = tg.target(async () => {
	let artifact = build();
	await std.assert.pkg({
		buildFunction: build,
		binaries: ["lz4"],
		libraries: ["lz4"],
	});
	return artifact;
});
