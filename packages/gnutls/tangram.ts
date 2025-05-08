import * as gmp from "gmp" with { path: "../gmp" };
import * as nettle from "nettle" with { path: "../nettle" };
import pkgConfig from "pkgconf" with { path: "../pkgconf" };
import * as std from "std" with { path: "../std" };
import { $ } from "std" with { path: "../std" };
import * as zlib from "zlib" with { path: "../zlib" };

export const metadata = {
	homepage: "https://www.gnutls.org",
	license: "LGPL-2.1-or-later",
	name: "gnutls",
	repository: "https://gitlab.com/gnutls/gnutls",
	version: "3.7.11",
};

export const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:90e337504031ef7d3077ab1a52ca8bac9b2f72bc454c95365a1cd1e0e81e06e9";
	const extension = ".tar.xz";
	const base = `https://www.gnupg.org/ftp/gcrypt/${name}/v3.7`;
	return std.download
		.extractArchive({ base, checksum, name, extension, version })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		gmp?: gmp.Arg;
		nettle?: nettle.Arg;
		zlib?: zlib.Arg;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (...args: tg.Args<Arg>) => {
	const {
		autotools = {},
		build,
		dependencies: {
			gmp: gmpArg = {},
			nettle: nettleArg = {},
			zlib: zlibArg = {},
		} = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	const env = [
		gmp.build({ build, env: env_, host, sdk }, gmpArg),
		nettle.build({ build, env: env_, host, sdk }, nettleArg),
		pkgConfig({ build, host: build }),
		zlib.build({ build, env: env_, host, sdk }, zlibArg),
		{
			CFLAGS: tg.Mutation.prefix(
				"-Wno-implicit-int -Wno-deprecated-non-prototype",
				" ",
			),
		},
		env_,
	];

	const configure = {
		args: [
			"--disable-doc",
			"--with-included-libtasn1",
			"--with-included-unistring",
			"--without-p11-kit",
		],
	};

	const phases = { configure };

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env: std.env.arg(...env),
			phases,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);
};

export default build;

export const test = async () => {
	// TODO spec
	const source = tg.directory({
		["main.c"]: tg.file(`
			#include <stdio.h>
			int main () {}
		`),
	});

	return await $`
			echo "Checking if we can link against gnutls."
			cc ${source}/main.c -o $OUTPUT -lnettle -lhogweed -lgmp -lgnutls -lz
		`
		.env(std.sdk())
		.env(build())
		.env(nettle.build())
		.env(gmp.build())
		.env(zlib.build());
};
