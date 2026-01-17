import * as std from "../../tangram.ts";

export const metadata = {
	homepage: "https://github.com/westes/flex",
	license: "https://github.com/westes/flex/tree/master?tab=License-1-ov-file",
	name: "flex",
	repository: "https://github.com/westes/flex",
	version: "2.6.4",
	tag: "flex/2.6.4",
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:e87aae032bf07c26f85ac0ed3250998c37621d95f8bd748b31f15b33c45ee995";
	const owner = "westes";
	const repo = name;
	const tag = `v${version}`;
	return std.download.fromGithub({
		checksum,
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
			phases: {
				configure: {
					args: [
						"--disable-dependency-tracking",
						"--disable-nls",
						"--disable-rpath",
					],
				},
			},
		},
		...args,
	);
};

export default build;

export const test = async () => {
	return await build();
};
