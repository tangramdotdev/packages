import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://facebook.github.io/zstd/",
	license: "BSD-3-Clause",
	name: "zstd",
	repository: "https://github.com/facebook/zstd",
	version: "1.5.7",
	tag: "zstd/1.5.7",
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

export type Arg = std.autotools.Arg;

export const build = (...args: std.Args<Arg>) =>
	std.autotools.build(
		{
			source: source(),
			buildInTree: true,
			prefixArg: "none",
			order: ["prepare", "build", "install"],
			phases: { install: tg`make install PREFIX=${tg.output}` },
		},
		...args,
	);

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
