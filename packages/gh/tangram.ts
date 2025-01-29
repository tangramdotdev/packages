import * as go from "go" with { path: "../go" };
import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://cli.github.com",
	license: "MIT",
	name: "gh",
	repository: "https://github.com/cli/cli",
	version: "2.60.0",
};

export const source = tg.target(() => {
	const { version } = metadata;
	const checksum =
		"sha256:1936a80a668caef437b2f409eaa10e48613a3502db7da9eea011b163769218a7";
	return std.download.fromGithub({
		checksum,
		owner: "cli",
		repo: "cli",
		source: "tag",
		tag: `v${version}`,
	});
});

type Arg = {
	build?: string;
	env?: std.env.Arg;
	go?: go.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = tg.target(async (...args: std.Args<Arg>) => {
	const {
		go: goArg = {},
		build,
		env,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);
	return go.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			sdk,
			source: source_ ?? source(),
			install: {
				command: `make install prefix="$OUTPUT"`,
			},
		},
		goArg,
	);
});

export default build;

export const provides = {
	binaries: ["gh"],
};

export const test = tg.target(async () => {
	const spec = {
		...std.assert.defaultSpec(provides, metadata),
		binaries: provides.binaries.map((name) => {
			return {
				name,
				testPredicate: (stdout: string) => stdout.includes(metadata.name),
			};
		}),
	};
	return await std.assert.pkg(build, spec);
});
