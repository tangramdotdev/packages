import * as gmp from "gmp" with { path: "../gmp" };
import * as nettle from "nettle" with { path: "../nettle" };
import * as std from "std" with { path: "../std" };
import { $ } from "std" with { path: "../std" };
import * as zlib from "zlib" with { path: "../zlib" };
import * as zstd from "zstd" with { path: "../zstd" };

export const metadata = {
	homepage: "https://www.gnutls.org",
	license: "LGPL-2.1-or-later",
	name: "gnutls",
	repository: "https://gitlab.com/gnutls/gnutls",
	version: "3.8.9",
};

export const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:69e113d802d1670c4d5ac1b99040b1f2d5c7c05daec5003813c049b5184820ed";
	const extension = ".tar.xz";
	const base = `https://www.gnupg.org/ftp/gcrypt/${name}/v3.8`;
	return std.download
		.extractArchive({ base, checksum, name, extension, version })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		gmp?: std.args.DependencyArg<gmp.Arg>;
		nettle?: std.args.DependencyArg<nettle.Arg>;
		zlib?: std.args.DependencyArg<zlib.Arg>;
		zstd?: std.args.OptionalDependencyArg<zstd.Arg>;
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
		dependencies: dependencyArgs = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	const deps = [
		std.env.runtimeDependency(gmp.build, dependencyArgs.gmp),
		std.env.runtimeDependency(nettle.build, dependencyArgs.nettle),
		std.env.runtimeDependency(zlib.build, dependencyArgs.zlib),
		std.env.runtimeDependency(zstd.build, dependencyArgs.zstd),
	];

	const envs: tg.Unresolved<Array<std.env.Arg>> = [
		...deps.map((dep) =>
			std.env.envArgFromDependency(build, env_, host, sdk, dep),
		),
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
			env: std.env.arg(...envs),
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
			cc ${source}/main.c -o $OUTPUT -lnettle -lhogweed -lgmp -lgnutls -lz -lzstd
		`
		.env(std.sdk())
		.env(build())
		.env(nettle.build())
		.env(gmp.build())
		.env(zstd.build())
		.env(zlib.build());
};
