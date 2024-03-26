import * as go from "tg:go" with { path: "../go" };
import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "gh",
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
		tag: `v${version}`,
		version,
	});
});

type Arg = {
	build?: string;
	env?: std.env.Arg;
	go?: tg.MaybeNestedArray<go.Arg>;
	host?: string;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let gh = tg.target(async (arg?: Arg) => {
	let { go: goArg = [], build, host, source: source_, ...rest } = arg ?? {};
	return go.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
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

export default gh;

export let test = tg.target(async () => {
	await std.assert.pkg({
		directory: await gh(),
		binaries: [
			{ name: "gh", testPredicate: (stdout) => stdout.includes(metadata.name) },
		],
		metadata,
	});
	return true;
});
