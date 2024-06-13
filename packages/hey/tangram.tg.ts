import * as go from "tg:go" with { path: "../go" };
import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "hey",
	version: "0.1.4",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:944097e62dd0bd5012d3b355d9fe2e7b7afcf13cc0b2c06151e0f4c2babfc279";
	let owner = "rakyll";
	let repo = name;
	let tag = `v${version}`;
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		source: "tag",
		tag,
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
	} = await std.args.apply<Arg>(...args);
	return go.build(
		{
			...std.triple.rotate({ build, host }),
			env,
			sdk,
			source: source_ ?? source(),
		},
		goArg,
	);
});

export default build;

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: build,
		binaries: ["hey"],
		// binaries: [
		// 	{ name: "hey", testPredicate: (stdout) => stdout.includes(metadata.name)i },
		// ],
		metadata,
	});
	return true;
});
