/** Bootstrapping the compiler toolchain requires these dependencies in addition to `std.utils`. */

import * as std from "../tangram.tg.ts";

import autoconf from "./dependencies/autoconf.tg.ts";
import automake from "./dependencies/automake.tg.ts";
import bc from "./dependencies/bc.tg.ts";
import bison from "./dependencies/bison.tg.ts";
import file from "./dependencies/file.tg.ts";
import flex from "./dependencies/flex.tg.ts";
import gperf from "./dependencies/gperf.tg.ts";
import help2man from "./dependencies/help2man.tg.ts";
import libffi from "./dependencies/libffi.tg.ts";
import libxcrypt from "./dependencies/libxcrypt.tg.ts";
import m4 from "./dependencies/m4.tg.ts";
import ncurses from "./dependencies/ncurses.tg.ts";
import perl from "./dependencies/perl.tg.ts";
import pkgconfig from "./dependencies/pkg_config.tg.ts";
import python from "./dependencies/python.tg.ts";
import texinfo from "./dependencies/texinfo.tg.ts";
import zlib from "./dependencies/zlib.tg.ts";
import zstd from "./dependencies/zstd.tg.ts";

export * as autoconf from "./dependencies/autoconf.tg.ts";
export * as automake from "./dependencies/automake.tg.ts";
export * as bc from "./dependencies/bc.tg.ts";
export * as bison from "./dependencies/bison.tg.ts";
export * as file from "./dependencies/file.tg.ts";
export * as flex from "./dependencies/flex.tg.ts";
export * as gperf from "./dependencies/gperf.tg.ts";
export * as help2man from "./dependencies/help2man.tg.ts";
export * as libffi from "./dependencies/libffi.tg.ts";
export * as libxcrypt from "./dependencies/libxcrypt.tg.ts";
export * as m4 from "./dependencies/m4.tg.ts";
export * as ncurses from "./dependencies/ncurses.tg.ts";
export * as perl from "./dependencies/perl.tg.ts";
export * as pkgconfig from "./dependencies/pkg_config.tg.ts";
export * as python from "./dependencies/python.tg.ts";
export * as texinfo from "./dependencies/texinfo.tg.ts";
export * as zlib from "./dependencies/zlib.tg.ts";
export * as zstd from "./dependencies/zstd.tg.ts";

export type Arg = std.sdk.BuildEnvArg;

/** Obtain a directory containing all provided utils. */
export let env = tg.target(async (arg?: Arg) => {
	let { host: host_, ...rest } = arg ?? {};
	let host = host_ ? tg.triple(host_) : await std.triple.host();

	let dependencies = [];

	// Add the standard utils.
	dependencies.push(await std.utils.env({ ...rest, host }));

	dependencies = dependencies.concat(
		await Promise.all([
			bc({ ...rest, host }),
			bison({ ...rest, host }),
			gperf({ ...rest, host }),
			libffi({ ...rest, host }),
			m4({ ...rest, host }),
			zlib({ ...rest, host }),
			zstd({ ...rest, host }),
		]),
	);

	dependencies = dependencies.concat(
		await Promise.all([
			perl({ ...rest, host }),
			pkgconfig({ ...rest, host }),
			ncurses({ ...rest, host }),
		]),
	);

	dependencies = dependencies.concat(
		await Promise.all([
			libxcrypt({ ...rest, host }),
			texinfo({ ...rest, host }),
		]),
	);

	dependencies = dependencies.concat(
		await Promise.all([
			autoconf({ ...rest, host }),
			automake({ ...rest, host }),
			file({ ...rest, host }),
			flex({ ...rest, host }),
			help2man({ ...rest, host }),
			python({ ...rest, host }),
		]),
	);

	// The final env contains the standard utils and all packages from this module.
	return dependencies;
});

export default env;

export let assertProvides = async (env: std.env.Arg) => {
	let names = [
		"aclocal",
		"automake",
		"bc",
		"file",
		"flex",
		"gperf",
		"help2man",
		"m4",
		"perl",
		"pkg-config",
		"python3",
		"texi2any", // texinfo
		"yacc", // bison
	];

	// This env should provide the standard utils and the set added in this module.
	await Promise.all([
		std.utils.assertProvides(env),
		std.env.assertProvides({ env, names }),
	]);
	return true;
};

import * as bootstrap from "../bootstrap.tg.ts";
export let test = tg.target(async () => {
	let host = bootstrap.toolchainTriple(await std.triple.host());
	let bootstrapMode = true;
	let sdk = std.sdk({ host, bootstrapMode });
	let deps = await env({ host, bootstrapMode, env: sdk });
	await assertProvides(deps);
	return true;
});
