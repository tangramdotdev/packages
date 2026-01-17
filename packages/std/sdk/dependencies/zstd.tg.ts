import * as std from "../../tangram.ts";

export const metadata = {
	name: "zstd",
	version: "1.5.7",
	tag: "zstd/1.5.7",
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

export const build = async (...args: std.Args<Arg>) => {
	return std.autotools.build(
		{
			source: source(),
			buildInTree: true,
			defaultCrossArgs: false,
			order: ["prepare", "build", "install"],
			phases: {
				install: tg`make install PREFIX=${tg.output}`,
			},
			prefixArg: "none",
		},
		...args,
	);
};

export default build;
