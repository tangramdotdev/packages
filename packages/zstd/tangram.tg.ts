import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://facebook.github.io/zstd/",
	license: "BSD-3-Clause",
	name: "zstd",
	repository: "https://github.com/facebook/zstd",
	version: "1.5.6",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:4aa8dd1c1115c0fd6b6b66c35c7f6ce7bd58cc1dfd3e4f175b45b39e84b14352";
	let owner = "facebook";
	let repo = name;
	let tag = `v${version}`;
	return std.download.fromGithub({
		checksum,
		compressionFormat: "zst",
		owner,
		repo,
		source: "release",
		tag,
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
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	let sourceDir = source_ ?? source();

	let install = `make install PREFIX=$OUTPUT`;
	let phases = { install };

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			buildInTree: true,
			phases: { phases, order: ["prepare", "build", "install"] },
			prefixArg: "none",
			sdk,
			source: sourceDir,
		},
		autotools,
	);
});

export default build;

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: build,
		binaries: ["zstd"],
		libraries: ["zstd"],
	});
	return true;
});
