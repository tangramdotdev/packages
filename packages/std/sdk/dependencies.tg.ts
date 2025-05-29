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

// This level thing doesn't make sense. Theser are bools, you need better logic for them.
export type Level = "pkgconfig" | "extended" | "python" | "devtools";

/** An env containing the standard utils plus additional build-time tools needed for toolchain components: m4, bison, perl, python */
export const buildTools = async (
	unresolvedArg: tg.Unresolved<BuildToolsArg>,
) => {
	const {
		host,
		level,
		buildToolchain: buildToolchain_,
	} = await tg.resolve(unresolvedArg);
	const os = std.triple.os(host);

	// This list collects artifacts to return. It does not include the build toolchain or standard utils..
	const retEnvs: tg.Unresolved<Array<std.env.Arg>> = [{ utils: false }];

	// The original env, with utils ensured.
	const buildToolchain = await std.env.arg(buildToolchain_);
	// A running modified build env including pieces we build along the way.
	let buildEnv = buildToolchain;

	const bashExe = await std.env
		.getArtifactByKey({ env: buildEnv, key: "SHELL" })
		.then(tg.File.expect);
	const pkgConfigArtifact = await pkgConfig({
		bashExe,
		host,
		bootstrap: true,
		env: buildEnv,
	});
	retEnvs.push(pkgConfigArtifact);
	buildEnv = await std.env.arg(buildEnv, pkgConfigArtifact, { utils: false });
	if (level === "pkgconfig") {
		return std.env.arg(...retEnvs);
	}

	// Some dependencies depend on previous builds, so they are manually ordered here.
	const m4Artifact = await m4({
		host,
		bootstrap: true,
		env: buildEnv,
	});
	buildEnv = await std.env.arg(buildEnv, m4Artifact, { utils: false });

	const bisonArtifact = await bison({
		host,
		bootstrap: true,
		env: buildEnv,
	});
	buildEnv = await std.env.arg(buildEnv, bisonArtifact, { utils: false });

	if (os === "darwin") {
		const libiconvArtifact = await libiconv({
			host,
			bootstrap: true,
			env: buildToolchain,
		});
		retEnvs.push(libiconvArtifact);
		buildEnv = await std.env.arg(buildEnv, libiconvArtifact, { utils: false });
	}

	const gettextArtifact = await gettext({
		host,
		bootstrap: true,
		env: buildEnv,
	});
	retEnvs.push(m4Artifact, bisonArtifact, gettextArtifact);
	buildEnv = await std.env.arg(buildEnv, gettextArtifact, { utils: false });

	const flexArtifact = await flex({
		host,
		bootstrap: true,
		env: buildEnv,
	});
	buildEnv = await std.env.arg(buildEnv, flexArtifact, { utils: false });

	const perlArtifact = await perl({
		host,
		bootstrap: true,
		env: buildEnv,
	});
	retEnvs.push(perlArtifact);
	if (level === "extended") {
		return std.env.arg(...retEnvs);
	}
	buildEnv = await std.env.arg(buildEnv, perlArtifact, { utils: false });

	const libxcryptArtifact = await libxcrypt({
		host,
		bootstrap: true,
		env: buildEnv,
	});
	buildEnv = await std.env.arg(buildEnv, libxcryptArtifact, { utils: false });
	const pythonArtifact = await tg.build(python, {
		host,
		bootstrap: true,
		env: buildEnv,
	});
	retEnvs.push(pythonArtifact);
	buildEnv = await std.env.arg(buildEnv, pythonArtifact, { utils: false });
	if (level === "python") {
		return std.env.arg(...retEnvs);
	}

	const grepArtifact = await grep({
		host,
		bootstrap: true,
		env: buildToolchain,
	});
	const grepExe = await grepArtifact.get("bin/grep").then(tg.File.expect);
	const sedArtifact = await sed({
		host,
		bootstrap: true,
		env: buildToolchain,
	});
	const sedExe = await sedArtifact.get("bin/sed").then(tg.File.expect);
	const libtoolArtifact = await libtool({
		bashExe,
		grepExe,
		sedExe,
		host,
		bootstrap: true,
		env: buildEnv,
	});
	const texinfoArtifact = await texinfo({
		host,
		bootstrap: true,
		env: buildEnv,
		perlArtifact,
	});
	buildEnv = await std.env.arg(buildEnv, texinfoArtifact, { utils: false });
	const autoconfArtifact = await tg.build(autoconf, {
		host,
		bootstrap: true,
		env: buildEnv,
		grepArtifact,
		m4Artifact,
		perlArtifact,
	});
	buildEnv = await std.env.arg(buildEnv, autoconfArtifact, { utils: false });
	const help2manArifact = await tg.build(help2man, {
		host,
		bootstrap: true,
		env: buildEnv,
		perlArtifact,
	});
	buildEnv = await std.env.arg(buildEnv, help2manArifact, { utils: false });
	const automakeArtifact = await tg.build(automake, {
		host,
		bootstrap: true,
		env: buildEnv,
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
	debug?: boolean;
	host: string;
	buildToolchain: std.env.Arg;
	/** Should we include gmp/isl/mfpr/mpc? Default: true */
	withGccLibs?: boolean;
};

/** An env containing libraries built for the given host: gmp, mpfr, isl, mpc, zlib, zstd. Assumes the incoming env contains a toolchain plus the build tools (m4 is required). */
export const hostLibraries = async (arg: tg.Unresolved<HostLibrariesArg>) => {
	const {
		debug = false,
		host,
		buildToolchain,
		withGccLibs = true,
	} = await tg.resolve(arg);

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
		const gmpArtifact = gmp({
			debug,
			host,
			bootstrap: true,
			env: buildToolchain,
		});
		console.log("GMP", await (await gmpArtifact).id());
		ret.push(gmpArtifact);
		let gmpEnv = std.env.arg(buildToolchain, gmpArtifact, { utils: false });

		const islArtifact = isl({ host, bootstrap: true, env: gmpEnv });
		ret.push(islArtifact);

		const mpfrArtifact = mpfr({ host, bootstrap: true, env: gmpEnv });
		ret.push(mpfrArtifact);
		gmpEnv = std.env.arg(gmpEnv, mpfrArtifact, { utils: false });

		const mpcArtifact = mpc({
			host,
			bootstrap: true,
			env: gmpEnv,
		});
		ret.push(mpcArtifact);
	}

	return await std.env.arg(...ret, { utils: false });
};
