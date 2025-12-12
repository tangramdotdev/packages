import * as std from "std" with { local: "./std" };
import * as cmake from "cmake" with { local: "./cmake" };

export const metadata = {
	homepage: "https://xiph.org/ogg",
	name: "ogg",
	version: "1.3.6",
	tag: "ogg/1.3.6",
	provides: {},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:5c8253428e181840cd20d41f3ca16557a9cc04bad4a3d04cce84808677fa1061";
	return std
		.download({
			url: `https://downloads.xiph.org/releases/ogg/libogg-${version}.tar.xz`,
			checksum,
			mode: "extract",
		})
		.then(tg.Directory.expect)
		.then((d) => d.get(`lib${name}-${version}`))
		.then(tg.Directory.expect);
};

export type Arg = cmake.Arg;

export const build = (...args: std.Args<Arg>) =>
	cmake.build({ source: source() }, ...args);

export const env = () =>
	std.env.arg({
		PKG_CONFIG_PATH: tg.Mutation.suffix(tg`${build()}/lib64/pkgconfig`, ":"),
	});

export default build;
