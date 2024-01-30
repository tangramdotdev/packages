/** Bootstrapping the compiler toolchain requires these dependencies in addition to `std.utils`. */

import * as std from "../tangram.tg.ts";

import autoconf from "./dependencies/autoconf.tg.ts";
import automake from "./dependencies/automake.tg.ts";
import bc from "./dependencies/bc.tg.ts";
import bison from "./dependencies/bison.tg.ts";
import bzip2 from "./dependencies/bzip2.tg.ts";
import file from "./dependencies/file.tg.ts";
import flex from "./dependencies/flex.tg.ts";
import gperf from "./dependencies/gperf.tg.ts";
import help2man from "./dependencies/help2man.tg.ts";
import libffi from "./dependencies/libffi.tg.ts";
import m4 from "./dependencies/m4.tg.ts";
import make from "./dependencies/make.tg.ts";
import patch from "./dependencies/patch.tg.ts";
import perl from "./dependencies/perl.tg.ts";
import pkgconfig from "./dependencies/pkg_config.tg.ts";
import python from "./dependencies/python.tg.ts";
import texinfo from "./dependencies/texinfo.tg.ts";
import xz from "./dependencies/xz.tg.ts";
import zlib from "./dependencies/zlib.tg.ts";
import zstd from "./dependencies/zstd.tg.ts";

export * as autoconf from "./dependencies/autoconf.tg.ts";
export * as automake from "./dependencies/automake.tg.ts";
export * as bc from "./dependencies/bc.tg.ts";
export * as bison from "./dependencies/bison.tg.ts";
export * as bzip2 from "./dependencies/bzip2.tg.ts";
export * as file from "./dependencies/file.tg.ts";
export * as flex from "./dependencies/flex.tg.ts";
export * as gperf from "./dependencies/gperf.tg.ts";
export * as help2man from "./dependencies/help2man.tg.ts";
export * as libffi from "./dependencies/libffi.tg.ts";

export * as m4 from "./dependencies/m4.tg.ts";
export * as make from "./dependencies/make.tg.ts";
export * as patch from "./dependencies/patch.tg.ts";
export * as perl from "./dependencies/perl.tg.ts";
export * as pkgconfig from "./dependencies/pkg_config.tg.ts";
export * as python from "./dependencies/python.tg.ts";
export * as texinfo from "./dependencies/texinfo.tg.ts";
export * as xz from "./dependencies/xz.tg.ts";
export * as zlib from "./dependencies/zlib.tg.ts";
export * as zstd from "./dependencies/zstd.tg.ts";

export type Arg = std.sdk.BuildEnvArg;

/** Obtain a directory containing all provided utils. */
export let env = tg.target(async (arg?: Arg) => {
	let dependencies = [];

	// Add the standard utils.
	dependencies.push(await std.utils.env(arg));

	// // Add `make` built against the standard utils.
	// dependencies.push(await make(arg));

	// dependencies = dependencies.concat(
	// 	await Promise.all([bc(arg), bison(arg), bzip2(arg), gperf(arg), m4(arg)]),
	// );

	// dependencies = dependencies.concat(
	// 	await Promise.all([libffi(arg), patch(arg), xz(arg), zlib(arg), zstd(arg)]),
	// );

	// dependencies = dependencies.concat(
	// 	await Promise.all([perl(arg), pkgconfig(arg), python(arg), texinfo(arg)]),
	// );

	// dependencies = dependencies.concat(
	// 	await Promise.all([
	// 		autoconf(arg),
	// 		automake(arg),
	// 		file(arg),
	// 		flex(arg),
	// 		help2man(arg),
	// 	]),
	// );
	dependencies.push(await make(arg));
	dependencies.push(await bc(arg));
	dependencies.push(await bison(arg));
	dependencies.push(await bzip2(arg));
	dependencies.push(await gperf(arg));
	dependencies.push(await m4(arg));
	dependencies.push(await libffi(arg));
	dependencies.push(await patch(arg));
	dependencies.push(await xz(arg));
	dependencies.push(await zlib(arg));
	dependencies.push(await zstd(arg));
	dependencies.push(await perl(arg));
	dependencies.push(await pkgconfig(arg));
	dependencies.push(await python(arg));
	dependencies.push(await texinfo(arg));
	dependencies.push(await autoconf(arg));
	dependencies.push(await automake(arg));
	dependencies.push(await file(arg));
	dependencies.push(await flex(arg));
	dependencies.push(await help2man(arg));

	// The final env contains the standard utils and all packages from this module.
	return std.env(...dependencies, { bootstrapMode: true });
});

export default env;

export let assertProvides = async (env: std.env.Arg) => {
	let names = [
		"aclocal",
		"automake",
		"bc",
		"bzip2",
		"file",
		"flex",
		"gperf",
		"help2man",
		"m4",
		"make",
		"patch",
		"perl",
		"pkg-config",
		"python3",
		"texi2any", // texinfo
		"xz",
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
	let host = bootstrap.toolchainTriple(await std.Triple.host());
	await assertProvides(await env({ host, sdk: { bootstrapMode: true } }));
	return true;
});
