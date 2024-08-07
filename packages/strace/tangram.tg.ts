import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://github.com/strace/strace",
	name: "strace",
	license: "https://github.com/strace/strace/blob/master/COPYING",
	repository: "https://github.com/strace/strace",
	version: "6.10",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let owner = name;
	let repo = name;
	let tag = `v${version}`;
	let checksum =
		"sha256:765ec71aa1de2fe37363c1e40c7b7669fc1d40c44bb5d38ba8e8cd82c4edcf07";
	return std.download.fromGithub({
		checksum,
		compressionFormat: "xz",
		owner,
		repo,
		tag,
		source: "release",
		version,
	});
});

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let build = tg.target(async (...args: std.Args<Arg>) => {
	let {
		autotools = {},
		build,
		env,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default build;

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: build,
		binaries: ["strace"],
		metadata,
	});
	return true;
});
