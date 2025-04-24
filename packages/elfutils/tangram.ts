import * as bzip2 from "bzip2" with { path: "../bzip2" };
import * as libarchive from "libarchive" with { path: "../libarchive" };
import * as openssl from "openssl" with { path: "../openssl" };
import * as std from "std" with { path: "../std" };
import * as xz from "xz" with { path: "../xz" };
import * as zlib from "zlib" with { path: "../zlib" };

export const metadata = {
	homepage: "https://sourceware.org/elfutils/",
	license: "GPL-3.0-or-later",
	name: "elfutils",
	repository: "https://sourceware.org/git/?p=elfutils.git;a=summary",
	version: "0.191",
};

export const source = tg.command(async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:df76db71366d1d708365fc7a6c60ca48398f14367eb2b8954efc8897147ad871";
	const extension = ".tar.bz2";
	const base = `https://sourceware.org/elfutils/ftp/${version}`;
	return await std
		.download({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		bzip2?: bzip2.Arg;
		libarchive?: libarchive.Arg;
		openssl?: openssl.Arg;
		xz?: xz.Arg;
		zlib?: zlib.Arg;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = tg.command(async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		dependencies: {
			bzip2: bzip2Arg = {},
			libarchive: libarchiveArg = {},
			openssl: opensslArg = {},
			xz: xzArg = {},
			zlib: zlibArg = {},
		} = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	const configure = {
		args: [
			"--enable-deterministic-archives",
			"--program-prefix=eu-",
			"--disable-nls",
			"--disable-rpath",
			"--enable-install-elfh",
			"--without-libiconv-prefix",
			"--without-libintl-prefix",
			// FIXME - figure out how to get debuginfod to build
			"--disable-debuginfod",
			"--enable-libdebuginfod=dummy",
		],
	};

	if (build !== host) {
		configure.args.push(`--host=${host}`);
	}

	const phases = { configure };

	const env = [
		bzip2.build({ build, env: env_, host, sdk }, bzip2Arg),
		libarchive.build({ build, env: env_, host, sdk }, libarchiveArg),
		openssl.build({ build, env: env_, host, sdk }, opensslArg),
		xz.build({ build, env: env_, host, sdk }, xzArg),
		zlib.build({ build, env: env_, host, sdk }, zlibArg),
		{
			CFLAGS: tg.Mutation.suffix(
				"-Wno-format-nonliteral -lz -lbz2 -llzma",
				" ",
			),
		},
		env_,
	];

	const result = await std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env: std.env.arg(env),
			phases,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);

	return result;
});

export default build;

export const test = tg.command(() => {
	return tg.unimplemented();
});
