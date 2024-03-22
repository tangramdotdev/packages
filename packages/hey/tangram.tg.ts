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
		tag,
		version,
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

export let hey = tg.target(async (arg?: Arg) => {
	let { go: goArg = [], build, host, source: source_, ...rest } = arg ?? {};
	return go.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			source: source_ ?? source(),
		},
		goArg,
	);
});

export default hey;

export let test = tg.target(async () => {
	await std.assert.pkg({
		directory: await hey(),
		binaries: ["hey"],
		// binaries: [
		// 	{ name: "hey", testPredicate: (stdout) => stdout.includes(metadata.name)i },
		// ],
		metadata,
	});
	return true;
});
