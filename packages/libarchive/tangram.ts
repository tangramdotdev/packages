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
	version: "3.7.2",
};

export const source = tg.target(async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:04357661e6717b6941682cde02ad741ae4819c67a260593dfb2431861b251acb";
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

export const default_ = tg.target(async (...args: std.Args<Arg>) => {
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
		bzip2.default_({ build, env: env_, host, sdk }, bzip2Arg),
		libiconv.default_({ build, env: env_, host, sdk }, libiconvArg),
		openssl.default_({ build, env: env_, host, sdk }, opensslArg),
		xz.default_({ build, env: env_, host, sdk }, xzArg),
		zlib.default_({ build, env: env_, host, sdk }, zlibArg),
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

export default default_;

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
		default_(),
		bzip2.default_(),
		libiconv.default_(),
		openssl.default_(),
		xz.default_(),
		zlib.default_(),
	);
});
