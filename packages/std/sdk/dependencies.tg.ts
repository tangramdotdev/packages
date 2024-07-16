/** Bootstrapping the compiler toolchain requires these dependencies in addition to `std.utils`. */

import * as std from "../tangram.tg.ts";
import * as bootstrap from "../bootstrap.tg.ts";

import bison from "./dependencies/bison.tg.ts";
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

export type Arg = {
	host?: string;
	// If not provided, falls back to the bootstrap tools.
	buildToolchain?: std.env.Arg;
};

export let env = async (arg?: Arg) => {
	let { host: host_, buildToolchain } = arg ?? {};
	let host = host_ ?? (await std.triple.host());
	if (buildToolchain === undefined) {
		host = await bootstrap.toolchainTriple(host);
		buildToolchain = await bootstrap.sdk(host);
	}
	let utils = std.utils.env({ host, sdk: false, env: buildToolchain });
	// This env is used to build the remaining dependencies only. It includes the bootstrap SDK.
	let utilsEnv = std.env.arg(utils, buildToolchain);

	// Some dependencies depend on previous builds, so they are manually ordered here.
	let m4Artifact = m4({ host, sdk: false, env: utilsEnv });
	let zlibArtifact = zlib({ host, sdk: false, env: utilsEnv });
	let zstdArtifact = zstd({ host, sdk: false, env: utilsEnv });
	utilsEnv = std.env.arg(utilsEnv, m4Artifact);

	// These libraries depend on m4, but no other library depends on them. Build them here and use a separate env to thread dependencies..
	let gmpArtifact = gmp({ host, sdk: false, env: utilsEnv });
	let gmpUtilsEnv = std.env.arg(utilsEnv, gmpArtifact);

	let islArtifact = isl({ host, sdk: false, env: gmpUtilsEnv });
	let mpfrArtifact = mpfr({ host, sdk: false, env: gmpUtilsEnv });
	gmpUtilsEnv = std.env.arg(gmpUtilsEnv, mpfrArtifact);
	let mpcArtifact = mpc({
		host,
		sdk: false,
		env: gmpUtilsEnv,
	});

	let bisonArtifact = bison({ host, sdk: false, env: utilsEnv });
	utilsEnv = std.env.arg(utilsEnv, bisonArtifact);

	let perlArtifact = perl({ host, sdk: false, env: utilsEnv });
	utilsEnv = std.env.arg(utilsEnv, perlArtifact);

	let libxcryptArtifact = libxcrypt({
		host,
		sdk: false,
		env: utilsEnv,
	});
	utilsEnv = std.env.arg(utilsEnv, libxcryptArtifact);

	let pythonArtifact = python({ host, sdk: false, env: utilsEnv });

	// This env contains the standard utils and additional tools, but NO SDK, so each build step can swap the compiler out accordingly.
	return await std.env.arg(
		utils,
		gmpArtifact,
		islArtifact,
		m4Artifact,
		mpcArtifact,
		mpfrArtifact,
		bisonArtifact,
		perlArtifact,
		libxcryptArtifact,
		pythonArtifact,
		zlibArtifact,
		zstdArtifact,
	);
};
