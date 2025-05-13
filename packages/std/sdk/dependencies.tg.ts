/** Bootstrapping the compiler toolchain requires these dependencies in addition to `std.utils`. */

import * as std from "../tangram.ts";

import bison from "./dependencies/bison.tg.ts";
import flex from "./dependencies/flex.tg.ts";
import gmp from "./dependencies/gmp.tg.ts";
import isl from "./dependencies/isl.tg.ts";
import m4 from "../autotools/m4.tg.ts";
import mpc from "./dependencies/mpc.tg.ts";
import mpfr from "./dependencies/mpfr.tg.ts";
import libxcrypt from "./dependencies/libxcrypt.tg.ts";
import perl from "../autotools/perl.tg.ts";
import python from "./dependencies/python.tg.ts";
import zlib from "./dependencies/zlib.tg.ts";
import zstd from "./dependencies/zstd.tg.ts";

import grep from "../utils/grep.tg.ts";
import sed from "../utils/sed.tg.ts";
import libiconv from "../utils/libiconv.tg.ts";
import pkgConfig from "../autotools/pkgconf.tg.ts";
import gettext from "../autotools/gettext.tg.ts";
import libtool from "../autotools/libtool.tg.ts";
import texinfo from "../autotools/texinfo.tg.ts";
import autoconf from "../autotools/autoconf.tg.ts";
import help2man from "../autotools/help2man.tg.ts";
import automake from "../autotools/automake.tg.ts";

export * as bison from "./dependencies/bison.tg.ts";
export * as flex from "./dependencies/flex.tg.ts";
export * as gmp from "./dependencies/gmp.tg.ts";
export * as isl from "./dependencies/isl.tg.ts";
export * as m4 from "../autotools/m4.tg.ts";
export * as mpc from "./dependencies/mpc.tg.ts";
export * as mpfr from "./dependencies/mpfr.tg.ts";
export * as libxcrypt from "./dependencies/libxcrypt.tg.ts";
export * as perl from "../autotools/perl.tg.ts";
export * as python from "./dependencies/python.tg.ts";
export * as zlib from "./dependencies/zlib.tg.ts";
export * as zstd from "./dependencies/zstd.tg.ts";

export type BuildToolsArg = {
	host: string;
	buildToolchain: std.env.Arg;
	level: Level;
};

export type Level = "base" | "pkgconfig" | "extended" | "python" | "devtools";

/** An env containing the standard utils plus additional build-time tools needed for toolchain components: m4, bison, perl, python */
export const buildTools = async (
	unresolvedArg: tg.Unresolved<BuildToolsArg>,
) => {
	const { host, level, buildToolchain } = await tg.resolve(unresolvedArg);
	const os = std.triple.os(host);

	// This list collects artifacts to return. It does not include the build toolchain.
	const retEnvs: tg.Unresolved<Array<std.env.Arg>> = [];
	const utils = std.utils.env({ host, bootstrap: true, env: buildToolchain });
	retEnvs.push(utils);

	// This env is used to build the remaining dependencies only. It includes the build toolchain.
	let utilsEnv = std.env.arg(utils, buildToolchain);
	if (level === "base") {
		return std.env.arg(...retEnvs);
	}

	const bashExe = await std.env
		.getArtifactByKey({ env: await utils, key: "SHELL" })
		.then(tg.File.expect);
	const pkgConfigArtifact = pkgConfig({
		bashExe,
		host,
		bootstrap: true,
		env: utilsEnv,
	});
	retEnvs.push(pkgConfigArtifact);
	utilsEnv = std.env.arg(utilsEnv, pkgConfigArtifact);
	if (level === "pkgconfig") {
		return std.env.arg(...retEnvs);
	}

	// Some dependencies depend on previous builds, so they are manually ordered here.
	const m4Artifact = m4({ host, bootstrap: true, env: utilsEnv });
	utilsEnv = std.env.arg(utilsEnv, m4Artifact);

	const bisonArtifact = bison({ host, bootstrap: true, env: utilsEnv });
	utilsEnv = std.env.arg(utilsEnv, bisonArtifact);

	if (os === "darwin") {
		const libiconvArtifact = libiconv({
			host,
			bootstrap: true,
			env: std.env.arg(utils, buildToolchain),
		});
		retEnvs.push(libiconvArtifact);
		utilsEnv = std.env.arg(utilsEnv, libiconvArtifact);
	}

	const gettextArtifact = gettext({ host, bootstrap: true, env: utilsEnv });
	retEnvs.push(m4Artifact, bisonArtifact, gettextArtifact);
	utilsEnv = std.env.arg(utilsEnv, gettextArtifact);

	const flexArtifact = flex({ host, bootstrap: true, env: utilsEnv });
	utilsEnv = std.env.arg(utilsEnv, flexArtifact);

	const perlArtifact = perl({ host, bootstrap: true, env: utilsEnv });
	retEnvs.push(perlArtifact);
	if (level === "extended") {
		return std.env.arg(...retEnvs);
	}
	utilsEnv = std.env.arg(utilsEnv, perlArtifact);

	const libxcryptArtifact = libxcrypt({
		host,
		bootstrap: true,
		env: utilsEnv,
	});
	utilsEnv = std.env.arg(utilsEnv, libxcryptArtifact);
	const pythonArtifact = python({ host, bootstrap: true, env: utilsEnv });
	retEnvs.push(pythonArtifact);
	utilsEnv = std.env.arg(utilsEnv, pythonArtifact);
	if (level === "python") {
		return std.env.arg(...retEnvs);
	}

	const grepArtifact = await grep({
		host,
		bootstrap: true,
		env: std.env.arg(utils, buildToolchain),
	});
	const grepExe = await grepArtifact.get("bin/grep").then(tg.File.expect);
	const sedArtifact = await sed({
		host,
		bootstrap: true,
		env: std.env.arg(utils, buildToolchain),
	});
	const sedExe = await sedArtifact.get("bin/sed").then(tg.File.expect);
	const libtoolArtifact = libtool({
		bashExe,
		grepExe,
		sedExe,
		host,
		bootstrap: true,
		env: utilsEnv,
	});
	const texinfoArtifact = texinfo({
		host,
		bootstrap: true,
		env: utilsEnv,
		perlArtifact,
	});
	utilsEnv = std.env.arg(utilsEnv, texinfoArtifact);
	const autoconfArtifact = autoconf({
		host,
		bootstrap: true,
		env: utilsEnv,
		grepArtifact,
		m4Artifact,
		perlArtifact,
	});
	utilsEnv = std.env.arg(utilsEnv, autoconfArtifact);
	const help2manArifact = help2man({
		host,
		bootstrap: true,
		env: utilsEnv,
		perlArtifact,
	});
	utilsEnv = std.env.arg(utilsEnv, help2manArifact);
	const automakeArtifact = automake({
		host,
		bootstrap: true,
		env: utilsEnv,
		autoconfArtifact,
		perlArtifact,
	});
	retEnvs.push(
		libtoolArtifact,
		texinfoArtifact,
		autoconfArtifact,
		help2manArifact,
		automakeArtifact,
	);

	return std.env.arg(...retEnvs);
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
		bootstrap: true,
		env: buildToolchain,
	});
	const zstdArtifact = zstd({
		host,
		bootstrap: true,
		env: buildToolchain,
	});
	const ret = [zlibArtifact, zstdArtifact];

	if (withGccLibs) {
		// These libraries depend on m4, but no other library depends on them. Build them here and use a separate env to thread dependencies..
		const gmpArtifact = gmp({ host, bootstrap: true, env: buildToolchain });
		ret.push(gmpArtifact);
		let gmpEnv = std.env.arg(buildToolchain, gmpArtifact);

		const islArtifact = isl({ host, bootstrap: true, env: gmpEnv });
		ret.push(islArtifact);

		const mpfrArtifact = mpfr({ host, bootstrap: true, env: gmpEnv });
		ret.push(mpfrArtifact);
		gmpEnv = std.env.arg(gmpEnv, mpfrArtifact);

		const mpcArtifact = mpc({
			host,
			bootstrap: true,
			env: gmpEnv,
		});
		ret.push(mpcArtifact);
	}

	return await std.env.arg(...ret);
};
