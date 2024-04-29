import * as go from "tg:go" with { path: "../go" };
import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "fzf",
	version: "0.50.0",
};

export let source = tg.target((): Promise<tg.Directory> => {
	let { name, version } = metadata;
	let checksum =
		"sha256:3dd8f57eb58c039d343c23fbe1b4f03e441eb796d564c959f8241106805370d0";
	return std.download.fromGithub({
		checksum,
		owner: "junegunn",
		repo: name,
		source: "tag",
		tag: version,
	});
});

export type Arg = {
	build?: string;
	env?: std.env.Arg;
	go?: tg.MaybeNestedArray<go.Arg>;
	host?: string;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let fzf = tg.target(async (arg?: Arg) => {
	let { go: goArg = [], build, host, source: source_, ...rest } = arg ?? {};

	return go.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			checksum: "unsafe",
			source: source_ ?? source(),
		},
		goArg,
	);
});

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: fzf,
		binaries: [
			{ name: "fzf", testPredicate: (stdout) => stdout.includes("0.50") },
		],
		metadata,
	});
	return true;
});

export default fzf;
