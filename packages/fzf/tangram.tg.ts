import * as go from "tg:go" with { path: "../go" };
import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "fzf",
	version: "0.44.1",
};

export let source = tg.target((): Promise<tg.Directory> => {
	let { name, version } = metadata;
	let checksum =
		"sha256:295f3aec9519f0cf2dce67a14e94d8a743d82c19520e5671f39c71c9ea04f90c";
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
	await std.assert.pkg({
		directory: await fzf(),
		binaries: [
			{ name: "fzf", testPredicate: (stdout) => stdout.includes("0.44") },
		],
		metadata,
	});
	return true;
});

export default fzf;
