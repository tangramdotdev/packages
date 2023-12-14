import * as nodejs from "tg:nodejs" with { path: "../nodejs" };
import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "http-server",
	version: "14.1.1",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:55eabb10a644d593f447daa1872d29cdb4a231b32c86db75c7db96a3027e6564";
	let owner = "http-party";
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
	env?: std.env.Arg;
	host?: std.Triple.Arg;
	nodejs?: tg.MaybeNestedArray<nodejs.Arg>;
	source?: tg.Directory;
};

export let httpServer = tg.target(async (arg?: Arg) => {
	let { nodejs: nodeArgs = [], source: source_, ...rest } = arg ?? {};

	return nodejs.build(
		{
			...rest,
			source: source_ ?? source(),
			packageLock: tg.File.expect(await tg.include("./package-lock.json")),
		},
		nodeArgs,
	);
});

export default httpServer;

export let test = tg.target(async () => {
	await std.build(
		tg`
			http-server --version | tee $OUTPUT
		`,
		{ env: httpServer() },
	);
	return true;
});
