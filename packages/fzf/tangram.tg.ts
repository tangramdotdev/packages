import * as go from "tg:go" with { path: "../go" };
import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "fzf",
	version: "0.46.1",
};

export let source = tg.target((): Promise<tg.Directory> => {
	let { name, version } = metadata;
	let checksum =
		"sha256:b0d640be3ae79980fdf461096f7d9d36d38ec752e25f8c4d2ca3ca6c041c2491";
	return std.download.fromGithub({
		checksum,
		owner: "junegunn",
		repo: name,
		tag: version,
		version,
	});
});

export type Arg = {
	build?: std.Triple.Arg;
	env?: std.env.Arg;
	go?: tg.MaybeNestedArray<go.Arg>;
	host?: std.Triple.Arg;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let fzf = tg.target(async (arg?: Arg) => {
	let { go: goArg = [], build, host, source: source_, ...rest } = arg ?? {};

	return go.build(
		{
			...rest,
			...std.Triple.rotate({ build, host }),
			source: source_ ?? source(),
		},
		goArg,
	);
});

export let test = tg.target(async () => {
	let directory = fzf();
	await std.assert.pkg({
		directory,
		binaries: [
			{ name: "fzf", testPredicate: (stdout) => stdout.includes("0.46") },
		],
		metadata,
	});
	return directory;
});

export default fzf;
