import * as std from "std" with { local: "./std" };
import { $ } from "std" with { local: "./std" };
import * as cmake from "cmake" with { local: "./cmake" };
import * as ogg from "ogg" with { local: "./ogg.tg.ts" };

export const metadata = {
	homepage: "https://xiph.org/vorbis",
	name: "vorbis",
	version: "1.3.7",
	provides: {},
};

export const source = () => {
	std.download;
	const { name, version } = metadata;
	const checksum =
		"sha256:b33cc4934322bcbf6efcbacf49e3ca01aadbea4114ec9589d1b1e9d20f72954b";
	return std
		.download({
			url: `https://ftp.osuosl.org/pub/xiph/releases/${name}/lib${name}-${version}.tar.xz`,
			checksum,
			mode: "extract",
		})
		.then(tg.Directory.expect)
		.then((directory) => directory.get(`lib${name}-${version}`))
		.then(tg.Directory.expect);
};

export type Arg = cmake.Arg;

export const build = async (...args: std.Args<Arg>) => {
	return cmake.build(
		{ source: source() },
		{ env: std.env.arg(ogg.env()) },
		...args,
	);
};

export const env = () =>
	std.env.arg({
		PKG_CONFIG_PATH: tg.Mutation.suffix(tg`${build()}/lib64/pkgconfig`, ":"),
	});

export default build;
