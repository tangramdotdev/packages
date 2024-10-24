import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://facebook.github.io/zstd/",
	license: "BSD-3-Clause",
	name: "zstd",
	repository: "https://github.com/facebook/zstd",
	version: "1.5.6",
};

export const source = tg.target(() => {
	const { name, version } = metadata;
	const checksum =
		"sha256:4aa8dd1c1115c0fd6b6b66c35c7f6ce7bd58cc1dfd3e4f175b45b39e84b14352";
	const owner = "facebook";
	const repo = name;
	const tag = `v${version}`;
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

export const default_ = tg.target(async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	const sourceDir = source_ ?? source();

	const install = `make install PREFIX=$OUTPUT`;
	const phases = { install };

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

export default default_;

export const test = tg.target(async () => {
	await std.assert.pkg({
		packageDir: default_(),
		binaries: ["zstd"],
		libraries: ["zstd"],
	});
	return true;
});
