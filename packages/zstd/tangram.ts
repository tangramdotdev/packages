import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://facebook.github.io/zstd/",
	license: "BSD-3-Clause",
	name: "zstd",
	repository: "https://github.com/facebook/zstd",
	version: "1.5.7",
	provides: {
		binaries: ["zstd"],
		libraries: ["zstd"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:5b331d961d6989dc21bb03397fc7a2a4d86bc65a14adc5ffbbce050354e30fd2";
	const owner = "facebook";
	const repo = name;
	const tag = `v${version}`;
	return std.download.fromGithub({
		checksum,
		compression: "zst",
		owner,
		repo,
		source: "release",
		tag,
		version,
	});
};

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		host,
		sdk,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

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
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
