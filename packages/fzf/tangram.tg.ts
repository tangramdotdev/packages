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
		...rest
	} = await std.args.apply<Arg>(...args);

	return go.build(
		{
			...rest,
			...(await std.triple.rotate({ build, host })),
			checksum: "unsafe",
			source: source_ ?? source(),
		},
		goArg,
	);
});

export default build;

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: build,
		binaries: [
			{ name: "fzf", testPredicate: (stdout) => stdout.includes("0.50") },
		],
		metadata,
	});
	return true;
});
