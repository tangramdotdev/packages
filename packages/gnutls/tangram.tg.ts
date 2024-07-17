import * as gmp from "tg:gmp" with { path: "../gmp" };
import * as nettle from "tg:nettle" with { path: "../nettle" };
import * as std from "tg:std" with { path: "../std" };
import { $ } from "tg:std" with { path: "../std" };
import * as zlib from "tg:zlib" with { path: "../zlib" };

export let metadata = {
	homepage: "https://www.gnutls.org",
	license: "LGPL-2.1-or-later",
	name: "gnutls",
	repository: "https://gitlab.com/gnutls/gnutls",
	version: "3.7.10",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:b6e4e8bac3a950a3a1b7bdb0904979d4ab420a81e74de8636dd50b467d36f5a9";
	let extension = ".tar.xz";
	let base = `https://www.gnupg.org/ftp/gcrypt/${name}/v3.7`;
	return std
		.download({ base, checksum, name, extension, version })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

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

export let build = tg.target(async (...args: std.Args<Arg>) => {
	let {
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

	let env = [
		gmp.build({ build, env: env_, host, sdk }, gmpArg),
		nettle.build({ build, env: env_, host, sdk }, nettleArg),
		zlib.build({ build, env: env_, host, sdk }, zlibArg),
		env_,
	];

	let configure = {
		args: [
			"--disable-doc",
			"--with-included-libtasn1",
			"--with-included-unistring",
			"--without-p11-kit",
		],
	};

	let phases = { configure };

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env: std.env.arg(env),
			phases,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default build;

export let test = tg.target(async () => {
	let source = tg.directory({
		["main.c"]: tg.file(`
			#include <stdio.h>
			int main () {}
		`),
	});

	return await $`
			echo "Checking if we can link against gnutls."
			cc ${source}/main.c -o $OUTPUT -lnettle -lhogweed -lgmp -lgnutls -lz
		`.env(std.sdk(), build(), nettle.build(), gmp.build(), zlib.build());
});
