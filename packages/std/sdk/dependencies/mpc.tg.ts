import * as std from "../../tangram.ts";

export const metadata = {
	homepage: "https://www.multiprecision.org",
	name: "mpc",
	version: "1.4.1",
	tag: "mpc/1.4.1",
};

export function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:91204cd32f164bd3b7c992d4a6a8ce6519511aadab30f78b6982d0bf8d73e931";
	return std.download.fromGnu({ checksum, name, version, compression: "xz" });
}

export type Arg = std.autotools.Arg;

export async function build(...args: std.Args<Arg>) {
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
}

export default build;

export async function test() {
	return await build();
}
