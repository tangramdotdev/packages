import * as go from "go" with { path: "../go" };
import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://cli.github.com",
	license: "MIT",
	name: "gh",
	repository: "https://github.com/cli/cli",
	version: "2.69.0",
	provides: {
		binaries: ["gh"],
	},
};

export const source = tg.command(() => {
	const { version } = metadata;
	const checksum =
		"sha256:e2deb3759bbe4da8ad4f071ca604fda5c2fc803fef8b3b89896013e4b1c1fe65";
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

export const build = tg.command(async (...args: std.Args<Arg>) => {
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

			cgo: false,
			env,
			sdk,
			source: source_ ?? source(),
			generate: false,
			install: {
				command: `make install prefix="$OUTPUT"`,
			},
		},
		goArg,
	);
});

export default build;

export const test = tg.command(async () => {
	const spec = {
		...std.assert.defaultSpec(metadata),
		binaries: metadata.provides.binaries.map((name) => {
			return {
				name,
				testPredicate: (stdout: string) => stdout.includes(metadata.name),
			};
		}),
	};
	return await std.assert.pkg(build, spec);
});
