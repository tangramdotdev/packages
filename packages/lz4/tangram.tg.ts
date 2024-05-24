import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://lz4.org/",
	license:
		"https://github.com/lz4/lz4/blob/5ff839680134437dbf4678f3d0c7b371d84f4964/LICENSE",
	name: "lz4",
	repository: "https://github.com/lz4/lz4",
	version: "1.9.4",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:0b0e3aa07c8c063ddf40b082bdf7e37a1562bda40a0ff5272957f3e987e0e54b";
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

type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let lz4 = tg.target(async (arg?: Arg) => {
	let { autotools = {}, build, host, sdk, source: source_ } = arg ?? {};

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
			...std.triple.rotate({ build, host }),
			buildInTree: true,
			phases,
			sdk,
			source: sourceDir,
		},
		autotools,
	);
});

export default lz4;

export let test = tg.target(async () => {
	let artifact = lz4();
	await std.assert.pkg({
		buildFunction: lz4,
		binaries: ["lz4"],
		libraries: ["lz4"],
	});
	return artifact;
});
