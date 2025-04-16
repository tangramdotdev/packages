import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://lz4.org/",
	license:
		"https://github.com/lz4/lz4/blob/5ff839680134437dbf4678f3d0c7b371d84f4964/LICENSE",
	name: "lz4",
	repository: "https://github.com/lz4/lz4",
	version: "1.10.0",
	provides: {
		binaries: ["lz4"],
		libraries: ["lz4"],
	},
};

export const source = tg.command(() => {
	const { name, version } = metadata;
	const checksum =
		"sha256:537512904744b35e232912055ccf8ec66d768639ff3abe5788d90d792ec5f48b";
	const owner = name;
	const repo = name;
	const tag = `v${version}`;
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

export const build = tg.command(async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	const sourceDir = source_ ?? source();

	const install = {
		args: ["prefix=$OUTPUT"],
	};
	const phases = {
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

export const run = tg.command(async (...args: Array<tg.Value>) => {
	const dir = await build.build();
	return await tg.run({ executable: tg.symlink(tg`${dir}/bin/lz4`), args });
});

export const test = tg.command(async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
});
