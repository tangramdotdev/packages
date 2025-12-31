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
export * as libxml2 from "./dependencies/libxml2.tg.ts";
export * as perl from "../autotools/perl.tg.ts";
export * as python from "./dependencies/python.tg.ts";
export * as zlib from "./dependencies/zlib.tg.ts";
export * as zstd from "./dependencies/zstd.tg.ts";

export type BuildToolsArg = {
	host?: string;
	buildToolchain?: std.env.Arg;
	pkgConfig?: boolean;
	m4?: boolean;
	bison?: boolean;
	flex?: boolean;
	gettext?: boolean;
	perl?: boolean;
	python?: boolean;
	libtool?: boolean;
	texinfo?: boolean;
	autoconf?: boolean;
	help2man?: boolean;
	automake?: boolean;
	// Preset configurations - applied first, then individual flags override.
	preset?: Preset;
};

/**
 * Preset configurations for common use cases:
 * - "minimal": Only pkg-config
 * - "toolchain": Tools needed for compiler bootstrap (m4, bison, flex, perl, python) - NO gettext
 * - "autotools": Tools for building autotools packages (m4, bison, flex, perl, gettext)
 * - "autotools-dev": Full autotools development (includes autoconf, automake, libtool, etc.)
 */
export type Preset = "minimal" | "toolchain" | "autotools" | "autotools-dev";

/** Resolved configuration after applying preset and individual overrides */
type ResolvedConfig = {
	pkgConfig: boolean;
	m4: boolean;
	bison: boolean;
	flex: boolean;
	gettext: boolean;
	perl: boolean;
	python: boolean;
	libtool: boolean;
	texinfo: boolean;
	autoconf: boolean;
	help2man: boolean;
	automake: boolean;
};

/** Apply preset defaults, then override with individual flags */
const resolveConfig = (arg: BuildToolsArg): ResolvedConfig => {
	// Base defaults - everything off except pkgConfig
	let config: ResolvedConfig = {
		pkgConfig: true,
		m4: false,
		bison: false,
		flex: false,
		gettext: false,
		perl: false,
		python: false,
		libtool: false,
		texinfo: false,
		autoconf: false,
		help2man: false,
		automake: false,
	};

	// Apply preset
	switch (arg.preset) {
		case "minimal":
			break;
		case "toolchain":
			config = {
				...config,
				m4: true,
				bison: true,
				flex: true,
				perl: true,
				python: true,
			};
			break;
		case "autotools":
			config = {
				...config,
				m4: true,
				bison: true,
				flex: true,
				perl: true,
				gettext: true,
			};
			break;
		case "autotools-dev":
			config = {
				...config,
				m4: true,
				bison: true,
				flex: true,
				perl: true,
				gettext: true,
				libtool: true,
				texinfo: true,
				autoconf: true,
				help2man: true,
				automake: true,
			};
			break;
	}

	// Apply individual overrides
	if (arg.pkgConfig !== undefined) config.pkgConfig = arg.pkgConfig;
	if (arg.m4 !== undefined) config.m4 = arg.m4;
	if (arg.bison !== undefined) config.bison = arg.bison;
	if (arg.flex !== undefined) config.flex = arg.flex;
	if (arg.gettext !== undefined) config.gettext = arg.gettext;
	if (arg.perl !== undefined) config.perl = arg.perl;
	if (arg.python !== undefined) config.python = arg.python;
	if (arg.libtool !== undefined) config.libtool = arg.libtool;
	if (arg.texinfo !== undefined) config.texinfo = arg.texinfo;
	if (arg.autoconf !== undefined) config.autoconf = arg.autoconf;
	if (arg.help2man !== undefined) config.help2man = arg.help2man;
	if (arg.automake !== undefined) config.automake = arg.automake;

	return config;
};

/** An env containing build-time tools. Use presets or individual flags to control which tools are included. */
export const buildTools = async (
	unresolvedArg?: tg.Unresolved<BuildToolsArg>,
) => {
	const resolved = unresolvedArg ? await tg.resolve(unresolvedArg) : {};
	const { host: host_, buildToolchain: buildToolchain_ } = resolved;

	// Resolve configuration from preset + individual overrides
	const config = resolveConfig(resolved);

	// Default values
	const host = host_ ?? std.triple.host();
	const os = std.triple.os(host);

	// If no buildToolchain is provided, use SDK + utils as default.
	let buildToolchain: std.env.Arg;
	if (buildToolchain_) {
		buildToolchain = buildToolchain_;
	} else {
		const sdk = await tg.build(std.sdk).named("sdk");
		buildToolchain = await std.env.arg(
			sdk,
			await tg.build(std.utils.env, { env: sdk, host }).named("utils"),
		);
	}

	// This list collects artifacts to return. It does not include the build toolchain or standard utils.
	const retEnvs: std.Args<std.env.Arg> = [{ utils: false }];

	// A running modified build env including pieces we build along the way.
	let buildEnv = await std.env.arg(buildToolchain);

	// Track built artifacts that may be needed as dependencies for later tools
	let m4Artifact: tg.Directory | undefined;
	let perlArtifact: tg.Directory | undefined;
	let grepArtifact: tg.Directory | undefined;
	let autoconfArtifact: tg.Directory | undefined;

	// Get bash for tools that need it
	const bashExe = await std.env
		.getArtifactByKey({ env: buildEnv, key: "SHELL" })
		.then(tg.File.expect);

	// pkg-config
	if (config.pkgConfig) {
		const artifact = await pkgConfig({
			bashExe,
			host,
			bootstrap: true,
			env: buildEnv,
		});
		retEnvs.push(artifact);
		buildEnv = await std.env.arg(buildEnv, artifact, { utils: false });
	}

	// m4 - required by bison, flex, autoconf.
	if (config.m4 || config.bison || config.flex || config.autoconf) {
		m4Artifact = await m4({
			host,
			bootstrap: true,
			env: buildEnv,
		});
		if (config.m4) {
			retEnvs.push(m4Artifact);
		}
		buildEnv = await std.env.arg(buildEnv, m4Artifact, { utils: false });
	}

	// bison - uses m4.
	if (config.bison) {
		const artifact = await bison({
			host,
			bootstrap: true,
			env: buildEnv,
		});
		retEnvs.push(artifact);
		buildEnv = await std.env.arg(buildEnv, artifact, { utils: false });
	}

	// libiconv - Darwin only, needed for gettext.
	if (os === "darwin" && config.gettext) {
		const artifact = await libiconv({
			host,
			bootstrap: true,
			env: buildToolchain,
		});
		retEnvs.push(artifact);
		buildEnv = await std.env.arg(buildEnv, artifact, { utils: false });
	}

	// gettext - i18n support for autotools packages.
	if (config.gettext) {
		const artifact = await gettext({
			host,
			bootstrap: true,
			env: buildEnv,
		});
		retEnvs.push(artifact);
		buildEnv = await std.env.arg(buildEnv, artifact, { utils: false });
	}

	// flex - uses m4.
	if (config.flex) {
		const artifact = await flex({
			host,
			bootstrap: true,
			env: buildEnv,
		});
		retEnvs.push(artifact);
		buildEnv = await std.env.arg(buildEnv, artifact, { utils: false });
	}

	// perl - required by autoconf, automake, texinfo, help2man.
	if (
		config.perl ||
		config.autoconf ||
		config.automake ||
		config.texinfo ||
		config.help2man
	) {
		perlArtifact = await perl({
			host,
			bootstrap: true,
			env: buildEnv,
		});
		if (config.perl) {
			retEnvs.push(perlArtifact);
		}
		buildEnv = await std.env.arg(buildEnv, perlArtifact, { utils: false });
	}

	// python - requires libxcrypt.
	if (config.python) {
		const libxcryptArtifact = await libxcrypt({
			host,
			bootstrap: true,
			env: buildEnv,
		});
		buildEnv = await std.env.arg(buildEnv, libxcryptArtifact, { utils: false });

		const artifact = await tg
			.build(python, {
				host,
				bootstrap: true,
				env: buildEnv,
			})
			.named("python");
		retEnvs.push(artifact);
		buildEnv = await std.env.arg(buildEnv, artifact, { utils: false });
	}

	// Development tools - these require perl and m4 to already be built.
	const needsDevTools =
		config.libtool ||
		config.texinfo ||
		config.autoconf ||
		config.help2man ||
		config.automake;

	if (needsDevTools) {
		// grep and sed are needed by libtool and autoconf.
		grepArtifact = await grep({
			host,
			bootstrap: true,
			env: buildEnv,
		});
		const sedArtifact = await sed({
			host,
			bootstrap: true,
			env: buildEnv,
		});

		if (config.libtool) {
			const grepExe = await grepArtifact.get("bin/grep").then(tg.File.expect);
			const sedExe = await sedArtifact.get("bin/sed").then(tg.File.expect);
			const artifact = await libtool({
				bashExe,
				grepExe,
				sedExe,
				host,
				bootstrap: true,
				env: buildEnv,
			});
			retEnvs.push(artifact);
			buildEnv = await std.env.arg(buildEnv, artifact, { utils: false });
		}

		if (config.texinfo) {
			tg.assert(perlArtifact, "texinfo requires perl");
			const artifact = await texinfo({
				host,
				bootstrap: true,
				env: buildEnv,
				perlArtifact,
			});
			retEnvs.push(artifact);
			buildEnv = await std.env.arg(buildEnv, artifact, { utils: false });
		}

		if (config.autoconf || config.automake) {
			tg.assert(m4Artifact, "autoconf requires m4");
			tg.assert(perlArtifact, "autoconf requires perl");
			tg.assert(grepArtifact, "autoconf requires grep");
			autoconfArtifact = await tg
				.build(autoconf, {
					host,
					bootstrap: true,
					env: buildEnv,
					grepArtifact,
					m4Artifact,
					perlArtifact,
				})
				.named("autoconf");
			if (config.autoconf) {
				retEnvs.push(autoconfArtifact);
			}
			buildEnv = await std.env.arg(buildEnv, autoconfArtifact, {
				utils: false,
			});
		}

		if (config.help2man) {
			tg.assert(perlArtifact, "help2man requires perl");
			const artifact = await tg
				.build(help2man, {
					host,
					bootstrap: true,
					env: buildEnv,
					perlArtifact,
				})
				.named("help2man");
			retEnvs.push(artifact);
			buildEnv = await std.env.arg(buildEnv, artifact, { utils: false });
		}

		if (config.automake) {
			tg.assert(autoconfArtifact, "automake requires autoconf");
			tg.assert(perlArtifact, "automake requires perl");
			const artifact = await tg
				.build(automake, {
					host,
					bootstrap: true,
					env: buildEnv,
					autoconfArtifact,
					perlArtifact,
				})
				.named("automake");
			retEnvs.push(artifact);
			buildEnv = await std.env.arg(buildEnv, artifact, { utils: false });
		}
	}

	return std.env.arg(...retEnvs);
};

/** The autotools build tools built with the default SDK and utils for the detected host. This version uses the default SDK to ensure cache hits when used in autotools.build and the package automation script. */
export const autotoolsBuildTools = async () => {
	const host = std.triple.host();
	const sdk = await tg.build(std.sdk, { host }).named("sdk");
	const utils = await tg.build(std.buildDefaultEnv).named("default env");
	return tg
		.build(buildTools, {
			host,
			buildToolchain: std.env.arg(sdk, utils),
			preset: "autotools",
		})
		.named("autotools build tools");
};

/** Release helper - builds autotoolsBuildTools with a referent to this file for cache hits. */
export const buildAutotoolsBuildTools = async () => {
	return tg.build(autotoolsBuildTools).named("autotools build tools");
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
		const gmpArtifact = gmp({
			host,
			bootstrap: true,
			env: buildToolchain,
		});
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
