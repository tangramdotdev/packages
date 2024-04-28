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
	await std.assert.pkg({
		buildFunction: build,
		binaries: ["zstd"],
		libraries: ["zstd"],
	});
	return true;
});
