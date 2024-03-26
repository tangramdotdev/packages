import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://facebook.github.io/zstd/",
	license: "BSD-3-Clause",
	name: "zstd",
	repository: "https://github.com/facebook/zstd",
	version: "1.5.5",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let compressionFormat = ".zst" as const;
	let checksum =
		"sha256:ce264bca60eb2f0e99e4508cffd0d4d19dd362e84244d7fc941e79fa69ccf673";
	let owner = "facebook";
	let repo = name;
	let tag = `v${version}`;
	return std.download.fromGithub({
		checksum,
		compressionFormat,
		owner,
		repo,
		tag,
		release: true,
		version,
	});
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let build = tg.target(async (arg?: Arg) => {
	let { autotools = [], build, host, source: source_, ...rest } = arg ?? {};

	let sourceDir = source_ ?? source();

	let install = `make install PREFIX=$OUTPUT`;
	let phases = { install };

	return std.autotools.build({
		...rest,
		...std.triple.rotate({ build, host }),
		buildInTree: true,
		phases: { phases, order: ["prepare", "build", "install"] },
		prefixArg: "none",
		source: sourceDir,
	});
});

export default build;

export let test = tg.target(async () => {
	let directory = build();
	await std.assert.pkg({
		directory,
		binaries: ["zstd"],
		libs: ["zstd"],
	});
	return directory;
});
