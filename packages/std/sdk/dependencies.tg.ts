/** Bootstrapping the compiler toolchain requires these dependencies in addition to `std.utils`. */

import * as std from "../tangram.ts";

import bison from "./dependencies/bison.tg.ts";
import flex from "./dependencies/flex.tg.ts";
import gmp from "./dependencies/gmp.tg.ts";
import isl from "./dependencies/isl.tg.ts";
import m4 from "./dependencies/m4.tg.ts";
import mpc from "./dependencies/mpc.tg.ts";
import mpfr from "./dependencies/mpfr.tg.ts";
import libxcrypt from "./dependencies/libxcrypt.tg.ts";
import perl from "./dependencies/perl.tg.ts";
import python from "./dependencies/python.tg.ts";
import zlib from "./dependencies/zlib.tg.ts";
import zstd from "./dependencies/zstd.tg.ts";

export * as bison from "./dependencies/bison.tg.ts";
export * as flex from "./dependencies/flex.tg.ts";
export * as gmp from "./dependencies/gmp.tg.ts";
export * as isl from "./dependencies/isl.tg.ts";
export * as m4 from "./dependencies/m4.tg.ts";
export * as mpc from "./dependencies/mpc.tg.ts";
export * as mpfr from "./dependencies/mpfr.tg.ts";
export * as libxcrypt from "./dependencies/libxcrypt.tg.ts";
export * as perl from "./dependencies/perl.tg.ts";
export * as python from "./dependencies/python.tg.ts";
export * as zlib from "./dependencies/zlib.tg.ts";
export * as zstd from "./dependencies/zstd.tg.ts";

export type BuildToolsArg = {
	host: string;
	buildToolchain: std.env.Arg;
};

/** An env containing the standard utils plus additional build-time tools needed for toolchain components: m4, bison, perl, python */
export const buildTools = async (
	unresolvedArg: tg.Unresolved<BuildToolsArg>,
) => {
	const arg = await tg.resolve(unresolvedArg);
	const { host, buildToolchain } = arg;
	const utils = std.utils.env({ host, sdk: false, env: buildToolchain });
	// This env is used to build the remaining dependencies only. It includes the bootstrap SDK.
	let utilsEnv = std.env.arg(utils, buildToolchain);

	// Some dependencies depend on previous builds, so they are manually ordered here.
	const m4Artifact = m4({ host, sdk: false, env: utilsEnv });
	utilsEnv = std.env.arg(utilsEnv, m4Artifact);

	const bisonArtifact = bison({ host, sdk: false, env: utilsEnv });
	utilsEnv = std.env.arg(utilsEnv, bisonArtifact);

	const flexArtifact = flex({ host, sdk: false, env: utilsEnv });

	const perlArtifact = perl({ host, sdk: false, env: utilsEnv });
	utilsEnv = std.env.arg(utilsEnv, perlArtifact);

	const libxcryptArtifact = libxcrypt({
		host,
		sdk: false,
		env: utilsEnv,
	});
	utilsEnv = std.env.arg(utilsEnv, libxcryptArtifact);

	const pythonArtifact = python({ host, sdk: false, env: utilsEnv });

	// This env contains the standard utils and additional tools, but NO SDK, so each build step can swap the compiler out accordingly.
	return await std.env.arg(
		utils,
		m4Artifact,
		bisonArtifact,
		flexArtifact,
		perlArtifact,
		pythonArtifact,
	);
};

export type HostLibrariesArg = {
	host: string;
	buildToolchain: std.env.Arg;
	/** Should we include gmp/isl/mfpr/mpc? Default: true */
	withGccLibs?: boolean;
};

/** An env containing libraries built for the given host: gmp, mpfr, isl, mpc, zlib, zstd. Assumes the incoming env contains a toolchain plus the build tools (m4 is required). */
export const hostLibraries = async (arg: tg.Unresolved<HostLibrariesArg>) => {
	const { host, buildToolchain, withGccLibs = true } = await tg.resolve(arg);

	const zlibArtifact = zlib({
		host,
		sdk: false,
		env: buildToolchain,
	});
	const zstdArtifact = zstd({
		host,
		sdk: false,
		env: buildToolchain,
	});
	const ret = [zlibArtifact, zstdArtifact];

	if (withGccLibs) {
		// These libraries depend on m4, but no other library depends on them. Build them here and use a separate env to thread dependencies..
		const gmpArtifact = gmp({ host, sdk: false, env: buildToolchain });
		ret.push(gmpArtifact);
		let gmpEnv = std.env.arg(buildToolchain, gmpArtifact);

		const islArtifact = isl({ host, sdk: false, env: gmpEnv });
		ret.push(islArtifact);

		const mpfrArtifact = mpfr({ host, sdk: false, env: gmpEnv });
		ret.push(mpfrArtifact);
		gmpEnv = std.env.arg(gmpEnv, mpfrArtifact);

		const mpcArtifact = mpc({
			host,
			sdk: false,
			env: gmpEnv,
		});
		ret.push(mpcArtifact);
	}

	return await std.env.arg(...ret);
};
