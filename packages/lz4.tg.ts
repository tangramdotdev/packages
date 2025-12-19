import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://lz4.org/",
	license:
		"https://github.com/lz4/lz4/blob/5ff839680134437dbf4678f3d0c7b371d84f4964/LICENSE",
	name: "lz4",
	repository: "https://github.com/lz4/lz4",
	version: "1.10.0",
	tag: "lz4/1.10.0",
	provides: {
		binaries: ["lz4"],
		libraries: ["lz4"],
	},
};

export const source = () => {
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
};

export type Arg = std.autotools.Arg;

export const build = (...args: std.Args<Arg>) =>
	std.autotools.build(
		{
			source: source(),
			buildInTree: true,
			phases: {
				configure: tg.Mutation.unset(),
				install: {
					args: [tg`prefix=${tg.output}`],
				},
			},
		},
		...args,
	);

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
