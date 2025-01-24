import * as bzip2 from "bzip2" with { path: "../bzip2" };
import * as libiconv from "libiconv" with { path: "../libiconv" };
import * as openssl from "openssl" with { path: "../openssl" };
import * as std from "std" with { path: "../std" };
import { $ } from "std" with { path: "../std" };
import * as xz from "xz" with { path: "../xz" };
import * as zlib from "zlib" with { path: "../zlib" };

export const metadata = {
	homepage: "https://libarchive.org",
	license:
		"https://raw.githubusercontent.com/libarchive/libarchive/master/COPYING",
	name: "libarchive",
	repository: "https://github.com/libarchive/libarchive",
	version: "3.7.7",
};

export const source = tg.target(async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:879acd83c3399c7caaee73fe5f7418e06087ab2aaf40af3e99b9e29beb29faee";
	const extension = ".tar.xz";
	const base = `https://www.libarchive.org/downloads`;
	return std
		.download({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		bzip2?: bzip2.Arg;
		libiconv?: libiconv.Arg;
		openssl?: openssl.Arg;
		xz?: xz.Arg;
		zlib?: zlib.Arg;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = tg.target(async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		dependencies: {
			bzip2: bzip2Arg = {},
			libiconv: libiconvArg = {},
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
		args: ["--disable-dependency-tracking", "--disable-rpath", "--with-pic"],
	};

	if (build !== host) {
		configure.args.push(`--host=${host}`);
	}

	const phases = { configure };

	const env = std.env.arg(
		bzip2.build({ build, env: env_, host, sdk }, bzip2Arg),
		libiconv.build({ build, env: env_, host, sdk }, libiconvArg),
		openssl.build({ build, env: env_, host, sdk }, opensslArg),
		xz.build({ build, env: env_, host, sdk }, xzArg),
		zlib.build({ build, env: env_, host, sdk }, zlibArg),
		env_,
	);

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			phases,
			source: source_ ?? source(),
			sdk,
		},
		autotools,
	);
});

export default build;

export const test = tg.target(async () => {
	const source = tg.directory({
		["main.c"]: tg.file(`
			#include <stdio.h>
			int main () {}
		`),
	});

	return await $`
			echo "Checking if we can link against libarchive."
			cc ${source}/main.c -o $OUTPUT -lssl -lcrypto -larchive -lz -lbz2 -liconv -llzma
		`.env(
		std.sdk(),
		build(),
		bzip2.build(),
		libiconv.build(),
		openssl.build(),
		xz.build(),
		zlib.build(),
	);
});
