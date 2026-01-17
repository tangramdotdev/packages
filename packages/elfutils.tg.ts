import * as bzip2 from "bzip2" with { local: "./bzip2" };
import * as libarchive from "libarchive" with { local: "./libarchive.tg.ts" };
import * as openssl from "openssl" with { local: "./openssl.tg.ts" };
import * as std from "std" with { local: "./std" };
import * as xz from "xz" with { local: "./xz.tg.ts" };
import * as zlib from "zlib-ng" with { local: "./zlib-ng.tg.ts" };

export const metadata = {
	homepage: "https://sourceware.org/elfutils/",
	hostPlatforms: ["aarch64-linux", "x86_64-linux"],
	license: "GPL-3.0-or-later",
	name: "elfutils",
	repository: "https://sourceware.org/git/?p=elfutils.git;a=summary",
	version: "0.191",
	tag: "elfutils/0.191",
};

export const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:df76db71366d1d708365fc7a6c60ca48398f14367eb2b8954efc8897147ad871";
	const extension = ".tar.bz2";
	const base = `https://sourceware.org/elfutils/ftp/${version}`;
	return await std.download
		.extractArchive({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

export const deps = () =>
	std.deps({
		bzip2: bzip2.build,
		libarchive: libarchive.build,
		openssl: openssl.build,
		xz: xz.build,
		zlib: zlib.build,
	});

export type Arg = std.autotools.Arg & std.deps.Arg<typeof deps>;

export const build = (...args: std.Args<Arg>) =>
	std.autotools.build(
		{
			source: source(),
			deps,
			env: {
				CFLAGS: tg.Mutation.suffix(
					"-Wno-format-nonliteral -lz -lbz2 -llzma",
					" ",
				),
			},
			phases: {
				configure: {
					args: [
						"--enable-deterministic-archives",
						"--program-prefix=eu-",
						"--disable-nls",
						"--disable-rpath",
						"--enable-install-elfh",
						"--without-libiconv-prefix",
						"--without-libintl-prefix",
						// FIXME - figure out how to get debuginfod to build.
						"--disable-debuginfod",
						"--enable-libdebuginfod=dummy",
					],
				},
			},
		},
		...args,
	);

export default build;

export const test = () => {
	return tg.unimplemented();
};
