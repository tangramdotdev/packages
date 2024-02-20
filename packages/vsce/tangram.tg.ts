import * as node from "tg:nodejs" with { path: "../nodejs" };
import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "vsce",
	version: "2.15.0",
};

export let source = tg.target(() => {
	let { version } = metadata;
	let checksum =
		"sha256:07fbf5f5e2a03ed5d424166fad8a2a05ed8d74c7a5ff46b17690f1de286278f3";
	let owner = "microsoft";
	let repo = "vscode-vsce";
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
	env?: std.env.Arg;
	host?: tg.Triple.Arg;
	nodejs?: tg.MaybeNestedArray<node.Arg>;
	source?: tg.Directory;
};

export let vsce = tg.target(async (arg?: Arg) => {
	let { nodejs = [], source: source_, ...rest } = arg ?? {};

	return node.build(
		{
			...rest,
			source: source_ ?? source(),
			packageLock: tg.File.expect(await tg.include("./package-lock.json")),
		},
		nodejs,
	);
});

export default vsce;

export let test = tg.target(() => {
	return std.build(
		`
			echo "Checking that we can run vsce." | tee $OUTPUT
			vsce --version | tee -a $OUTPUT
		`,
		{ env: vsce() },
	);
});
