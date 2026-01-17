import * as std from "../../tangram.ts";
import * as bootstrap from "../../bootstrap.tg.ts";
import gcc15Patch from "./GMP_GCC15.patch" with { type: "file" };

export const metadata = {
	homepage: "https://gmplib.org",
	name: "gmp",
	version: "6.3.0",
	tag: "gmp/6.3.0",
};

export const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:a3c2b80201b89e68616f4ad30bc66aee4927c3ce50e33929ca819d5c43538898";
	return std.download
		.fromGnu({
			name,
			version,
			compression: "xz",
			checksum,
		})
		.then((dir) => bootstrap.patch(dir, gcc15Patch));
};

export type Arg = std.autotools.Arg;

export const build = async (...args: std.Args<Arg>) => {
	return std.autotools.build(
		{
			source: source(),
		},
		...args,
	);
};

export default build;

export const test = async () => {
	return await build();
};
