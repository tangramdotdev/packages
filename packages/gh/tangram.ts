import * as go from "go" with { path: "../go" };
import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://cli.github.com",
	license: "MIT",
	name: "gh",
	repository: "https://github.com/cli/cli",
	version: "2.65.0",
};

export const source = tg.target(() => {
	const { version } = metadata;
	const checksum =
		"sha256:af026f1b0368b1444a67a941f179ddce7e97333881ec0bbcb49fed29f4151241";
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

export const default_ = tg.target(async (...args: std.Args<Arg>) => {
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

export default default_;

export const test = tg.target(async () => {
	await std.assert.pkg({
		buildFn: default_,
		binaries: [
			{ name: "gh", testPredicate: (stdout) => stdout.includes(metadata.name) },
		],
		metadata,
	});
	return true;
});
