import * as std from "std" with { local: "../std" };
import { $ } from "std" with { local: "../std" };
import * as cmake from "cmake" with { local: "../cmake" };

export const metadata = {
	homepage: "https://opus-codec.org/",
	name: "opus",
	version: "opus/1.5.2",
	provides: {
		libs: ["opus"]
	},
};

export const source = () => {
	std.download;
	const { name, version } = metadata;
	const checksum =
		"sha256:65c1d2f78b9f2fb20082c38cbe47c951ad5839345876e46941612ee87f9a7ce1";
	return std
		.download({
			url: `https://downloads.xiph.org/releases/${name}/${name}-${version}.tar.gz`,
			checksum,
			mode: "extract",
		})
		.then(tg.Directory.expect)
		.then((directory) => directory.get(`${name}-${version}`))
		.then(tg.Directory.expect);
};

export type Arg = cmake.Arg;

export const build = async (...args: std.Args<Arg>) => {
	return cmake.build(
		{ source: source() },
		...args,
	);
};

export const env = () => std.env.arg({
	PKG_CONFIG_PATH: tg.Mutation.suffix(tg`${build()}/lib64/pkgconfig`, ":"),
});

export default build;
