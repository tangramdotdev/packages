import * as std from "../../tangram.ts";

export const metadata = {
	homepage: "https://www.mpfr.org",
	name: "mpfr",
	version: "4.2.2",
	tag: "mpfr/4.2.2",
};

export const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:b67ba0383ef7e8a8563734e2e889ef5ec3c3b898a01d00fa0a6869ad81c6ce01";
	return std.download.fromGnu({
		checksum,
		name,
		version,
		compression: "xz",
	});
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
