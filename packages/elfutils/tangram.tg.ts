import * as bzip2 from "tg:bzip2" with { path: "../bzip2" };
import * as libarchive from "tg:libarchive" with { path: "../libarchive" };
import * as m4 from "tg:m4" with { path: "../m4" };
import * as openssl from "tg:openssl" with { path: "../openssl" };
import * as std from "tg:std" with { path: "../std" };
import * as xz from "tg:xz" with { path: "../xz" };
import * as zlib from "tg:zlib" with { path: "../zlib" };

export let metadata = {
	homepage: "https://sourceware.org/elfutils/",
	license: "GPL-3.0-or-later",
	name: "elfutils",
	repository: "https://sourceware.org/git/?p=elfutils.git;a=summary",
	version: "0.191",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:df76db71366d1d708365fc7a6c60ca48398f14367eb2b8954efc8897147ad871";
	let extension = ".tar.bz2";
	let base = `https://sourceware.org/elfutils/ftp/${version}`;
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
		m4?: m4.Arg;
		openssl?: openssl.Arg;
		xz?: xz.Arg;
		zlib?: zlib.Arg;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let build = tg.target(async (...args: std.Args<Arg>) => {
	let {
		autotools = {},
		build,
		dependencies: {
			bzip2: bzip2Arg = {},
			libarchive: libarchiveArg = {},
			m4: m4Arg = {},
			openssl: opensslArg = {},
			xz: xzArg = {},
			zlib: zlibArg = {},
		} = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	let configure = {
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

	let phases = { configure };

	let env = [
		bzip2.build({ build, env: env_, host, sdk }, bzip2Arg),
		libarchive.build({ build, env: env_, host, sdk }, libarchiveArg),
		m4.build({ build, env: env_, host, sdk }, m4Arg),
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

	let result = await std.autotools.build(
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
