import * as std from "../../tangram.ts";

export const metadata = {
	homepage: "https://www.multiprecision.org",
	name: "mpc",
	version: "1.3.1",
	tag: "mpc/1.3.1",
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:ab642492f5cf882b74aa0cb730cd410a81edcdbec895183ce930e706c1c759b8";
	return std.download.fromGnu({ checksum, name, version });
};

export type Arg = std.autotools.Arg;

export const build = async (...args: std.Args<Arg>) => {
	return std.autotools.build(
		{
			source: source(),
			phases: {
				configure: {
					args: ["--disable-dependency-tracking"],
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
