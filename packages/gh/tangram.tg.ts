import * as go from "tg:go" with { path: "../go" };
import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://cli.github.com",
	license: "MIT",
	name: "gh",
	repository: "https://github.com/cli/cli",
	version: "2.40.1",
};

export let source = tg.target(() => {
	let { version } = metadata;
	let checksum =
		"sha256:0bb2af951b4716067747184b5b5bbd90c270edee5b45a84e62a5a803bf7ef467";
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

export let build = tg.target(async (...args: std.Args<Arg>) => {
	let {
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
				command: tg`
				make install prefix="$OUTPUT"
			`,
			},
		},
		goArg,
	);
});

export default build;

export let test = tg.target(async () => {
	await std.assert.pkg({
		directory: await build(),
		binaries: [
			{ name: "gh", testPredicate: (stdout) => stdout.includes(metadata.name) },
		],
		metadata,
	});
	return true;
});
