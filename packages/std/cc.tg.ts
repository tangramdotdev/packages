/** C/C++ compiler environment setup utilities. */

import * as std from "./tangram.ts";
import { buildTools, type Preset } from "./sdk/dependencies.tg.ts";

/** Arguments for compiler flags setup. */
export type FlagsArg = {
	/** The machine the build output will run on. */
	host: string;

	/** Should the flags include FORTIFY_SOURCE? `false` will disable, `true` will default to 3, values less than 0 or greater than 3 will throw an error. Default: 2. */
	fortifySource?: boolean | number | undefined;

	/** Use full RELRO? Will use partial if disabled. May cause long start-up times in large programs. Default: true. */
	fullRelro?: boolean | undefined;

	/** Should we add the extra set of hardening CFLAGS? Default: true. */
	hardeningCFlags?: boolean | undefined;

	/** The value to pass to `-march` in the default CFLAGS. Default: undefined. */
	march?: string | undefined;

	/** The value to pass to `-mtune` in the default CFLAGS. Default: "generic". */
	mtune?: string | undefined;

	/** The optlevel to pass. Default: "2". */
	opt?: "1" | "2" | "3" | "s" | "z" | "fast" | undefined;

	/** Compile with `-pipe`? This option allows the compiler to use pipes instead of temporary files internally, speeding up compilation at the cost of increased memory. Disable if compiling in low-memory environments. This has no effect on the output. Default: true. */
	pipe?: boolean | undefined;

	/** Should executables be stripped? Default: true. */
	stripExecutables?: boolean | undefined;
};

/**
 * Adds compiler flag mutations to an environment array.
 *
 * This provides the standard compiler flags used across C/C++ build systems:
 * - Optimization level (-O2 by default)
 * - Pipe flag for faster compilation
 * - March/mtune for architecture tuning
 * - FORTIFY_SOURCE for buffer overflow protection
 * - Hardening flags (stack protection, frame pointers, etc.)
 * - GLIBCXX_ASSERTIONS for C++ debug assertions
 * - Strip flags for smaller binaries
 * - RELRO for GOT protection on Linux
 */
export const flags = (arg: FlagsArg, envs: std.Args<std.env.Arg>): void => {
	const {
		host,
		fortifySource: fortifySource_ = 2,
		fullRelro = true,
		hardeningCFlags = true,
		march,
		mtune = "generic",
		opt = "2",
		pipe = true,
		stripExecutables = true,
	} = arg;

	const hostOs = std.triple.os(host);

	// C/C++ flags.
	if (opt) {
		const optFlag = tg.Mutation.suffix(`-O${opt}`, " ");
		envs.push({ CFLAGS: optFlag, CXXFLAGS: optFlag });
	}
	if (pipe) {
		const pipeFlag = tg.Mutation.suffix("-pipe", " ");
		envs.push({ CFLAGS: pipeFlag, CXXFLAGS: pipeFlag });
	}
	if (march !== undefined) {
		const marchFlag = tg.Mutation.suffix(`-march=${march}`, " ");
		envs.push({ CFLAGS: marchFlag, CXXFLAGS: marchFlag });
	}
	if (mtune !== undefined) {
		const mtuneFlag = tg.Mutation.suffix(`-mtune=${mtune}`, " ");
		envs.push({ CFLAGS: mtuneFlag, CXXFLAGS: mtuneFlag });
	}

	// FORTIFY_SOURCE.
	const fortifySource =
		typeof fortifySource_ === "number"
			? fortifySource_
			: fortifySource_
				? 3
				: undefined;
	if (fortifySource !== undefined) {
		if (fortifySource < 0 || fortifySource > 3) {
			throw new Error(
				`fortifySource must be between 0 and 3 inclusive, received ${fortifySource.toString()}`,
			);
		}
		envs.push({
			CPPFLAGS: tg.Mutation.suffix(
				`-Wp,-U_FORTIFY_SOURCE,-D_FORTIFY_SOURCE=${fortifySource}`,
				" ",
			),
		});
	}

	// Hardening CFLAGS.
	if (hardeningCFlags) {
		let extraCFlags = `-fasynchronous-unwind-tables -fexceptions -fno-omit-frame-pointer -mno-omit-leaf-frame-pointer -fstack-protector-strong`;
		if (hostOs === "linux") {
			extraCFlags = `${extraCFlags} -fstack-clash-protection`;
		}
		const extraFlags = tg.Mutation.suffix(extraCFlags, " ");
		envs.push({ CFLAGS: extraFlags, CXXFLAGS: extraFlags });
	}

	// GLIBCXX_ASSERTIONS for GNU environment.
	const environment = std.triple.environment(host);
	if (!environment || environment === "gnu") {
		envs.push({
			CXXFLAGS: tg.Mutation.suffix("-Wp,-D_GLIBCXX_ASSERTIONS", " "),
		});
	}

	// LDFLAGS.
	if (stripExecutables === true) {
		const stripFlag = hostOs === "darwin" ? `-Wl,-S` : `-s`;
		envs.push({ LDFLAGS: tg.Mutation.suffix(stripFlag, " ") });
	}
	if (hostOs === "linux" && hardeningCFlags) {
		const fullRelroString = fullRelro ? ",-z,now" : "";
		const extraLdFlags = `-Wl,-z,relro${fullRelroString} -Wl,--as-needed`;
		envs.push({ LDFLAGS: tg.Mutation.suffix(extraLdFlags, " ") });
	}
};

/** Arguments for complete C/C++ environment setup. */
export type EnvArg = FlagsArg & {
	/** Bootstrap mode will disable adding any implicit package builds like the SDK and standard utils. All dependencies must be explicitly provided via `env`. Default: false. */
	bootstrap?: boolean | undefined;

	/** The machine performing the compilation. */
	build?: string | undefined;

	/** Should the development environment include `texinfo`, `help2man`, `autoconf` and `automake`? Default: false. */
	developmentTools?: boolean | undefined;

	/** Should the build environment include `m4`, `bison`, `perl`, and `gettext`? Default: true. */
	extended?: boolean | undefined;

	/** Should the build environment include pkg-config? Default: true. */
	pkgConfig?: boolean | undefined;

	/** Arguments to use for the SDK. */
	sdk?: std.sdk.Arg | undefined;

	/** Any environment to merge with lower precedence than the C/C++ flags. */
	env?: std.env.Arg | undefined;
};

/**
 * Returns a complete C/C++ build environment with SDK, build tools, and compiler flags.
 *
 * This combines:
 * - SDK (compiler toolchain)
 * - Build tools (pkg-config, m4, bison, perl, gettext, etc. based on preset)
 * - Cross-compilation SDK (when build !== host)
 * - Compiler flags from `flags()`
 * - User-provided environment (highest precedence)
 */
export const env = async (arg: EnvArg): Promise<std.env.Arg> => {
	const {
		bootstrap = false,
		build: build_,
		developmentTools = false,
		env: userEnv,
		extended = true,
		host,
		pkgConfig = true,
		sdk: sdkArg,
		// Extract flag-related args.
		fortifySource,
		fullRelro,
		hardeningCFlags,
		march,
		mtune,
		opt,
		pipe,
		stripExecutables,
	} = arg;

	const build = build_ ?? host;
	const isCross = build !== host;
	const detectedHost = std.sdk.canonicalTriple(std.triple.host());
	const canUsePrebuiltBuildTools = build === detectedHost;
	const envs: std.Args<std.env.Arg> = [];

	// Add compiler flags.
	flags(
		{
			host,
			fortifySource,
			fullRelro,
			hardeningCFlags,
			march,
			mtune,
			opt,
			pipe,
			stripExecutables,
		},
		envs,
	);

	if (!bootstrap) {
		// Determine preset based on flags.
		let preset: Preset | undefined = undefined;
		if (pkgConfig) {
			preset = "minimal";
		}
		if (extended) {
			preset = "autotools";
		}
		if (developmentTools) {
			preset = "autotools-dev";
		}

		if (preset !== undefined) {
			// Set up the native SDK for the build machine.
			const sdkHost = canUsePrebuiltBuildTools ? detectedHost : build;
			const sdk =
				sdkArg !== undefined
					? await tg.build(std.sdk, sdkArg, { host: sdkHost }).named("sdk")
					: await tg.build(std.sdk, { host: sdkHost }).named("sdk");

			let buildToolsEnv: tg.Unresolved<std.env.Arg>;
			// Use the pre-built std.buildAutotoolsBuildTools for the "autotools" preset.
			if (preset === "autotools" && canUsePrebuiltBuildTools) {
				buildToolsEnv = await tg
					.build(std.buildAutotoolsBuildTools)
					.named("autotools build tools");
			} else {
				// For other presets or when build machine differs, build with explicit parameters.
				buildToolsEnv = await tg
					.build(buildTools, {
						host: build,
						buildToolchain: sdk,
						preset,
					})
					.named("build tools");
			}
			envs.push(sdk, buildToolsEnv);

			// Add a cross SDK if necessary.
			if (isCross) {
				// SDK runs on `build`, produces code for `host`.
				const crossSdk = await tg
					.build(std.sdk, sdkArg, {
						host: build,
						target: host,
					})
					.named("cross sdk");
				envs.push(crossSdk);
			}
		}
	}

	// Include any user-defined env with higher precedence.
	return std.env.arg(...envs, userEnv, { utils: false });
};
