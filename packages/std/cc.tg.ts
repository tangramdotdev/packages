/** C/C++ compiler environment setup utilities. */

import * as std from "./tangram.ts";
import {
	autotoolsPresetConfig,
	buildTools,
	buildToolsConfigEquals,
	type BuildToolsOverrides,
	type Preset,
	type ResolvedConfig,
	resolveBuildToolsConfig,
} from "./sdk/dependencies.tg.ts";

/** Arguments for compiler flags setup. */
export type FlagsArg = {
	/** The machine the build output will run on. */
	host: string;

	/** Should the flags include FORTIFY_SOURCE? `false` will disable, `true` will default to 3, values less than 0 or greater than 3 will throw an error. Default: 2. */
	fortifySource?: boolean | number;

	/** Use full RELRO? Will use partial if disabled. May cause long start-up times in large programs. Default: true. */
	fullRelro?: boolean;

	/** Should we add the extra set of hardening CFLAGS? Default: true. */
	hardeningCFlags?: boolean;

	/** The value to pass to `-march` in the default CFLAGS. Default: undefined. */
	march?: string;

	/** The value to pass to `-mtune` in the default CFLAGS. Default: "generic". */
	mtune?: string;

	/** The optlevel to pass. Default: "2". */
	opt?: "1" | "2" | "3" | "s" | "z" | "fast";

	/** Compile with `-pipe`? This option allows the compiler to use pipes instead of temporary files internally, speeding up compilation at the cost of increased memory. Disable if compiling in low-memory environments. This has no effect on the output. Default: true. */
	pipe?: boolean;

	/** Should executables be stripped? Default: true. */
	stripExecutables?: boolean;
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
export function flags(arg: FlagsArg, envs: tg.Args<std.env.Arg>): void {
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
}

/** Arguments for complete C/C++ environment setup. */
export type EnvArg = FlagsArg & {
	/** The machine performing the compilation. */
	build?: string;

	/** Should the development environment include `texinfo`, `help2man`, `autoconf` and `automake`? Default: false. */
	developmentTools?: boolean;

	/** Should the build environment include `m4`, `bison`, `perl`, and `gettext`? Default: true. */
	extended?: boolean;

	/** Should the build environment include pkg-config? Default: true. */
	pkgConfig?: boolean;

	/** Granular control over the individual build tools. A `preset` given here replaces the preset implied by `pkgConfig`, `extended`, and `developmentTools`, and the individual tool flags then override that preset. */
	buildTools?: BuildToolsOverrides;

	/** Arguments for the SDK, or `"none"` to add no toolchain, build tools, or standard utilities, in which case the caller must provide everything the build needs. Default: the default SDK for the build machine. */
	sdk?: std.sdk.Arg;

	/** Any environment to merge with lower precedence than the C/C++ flags. */
	env?: std.env.Arg;
};

/** The arguments that determine which build tools an environment receives. */
export type BuildToolsSelectionArg = {
	/** Granular control over the individual build tools. */
	buildTools?: BuildToolsOverrides;

	/** Should the development environment include `texinfo`, `help2man`, `autoconf` and `automake`? Default: false. */
	developmentTools?: boolean;

	/** Should the build environment include `m4`, `bison`, `perl`, and `gettext`? Default: true. */
	extended?: boolean;

	/** Should the build environment include pkg-config? Default: true. */
	pkgConfig?: boolean;
};

/** The outcome of resolving a build tools selection. */
export type BuildToolsSelection = {
	/** The argument to forward to `buildTools`, excluding `host` and `buildToolchain`. */
	arg: BuildToolsOverrides;

	/** The fully resolved set of tools the argument produces. */
	config: ResolvedConfig;

	/** Is the resolved set identical to the one the `autotools` preset produces? When it is, and the build machine is the detected host, the released prebuilt artifact may be used instead of building the tools. */
	matchesAutotoolsPreset: boolean;

	/** Are any build tools required? When this is false the environment omits the SDK, the build tools, and the cross SDK entirely. */
	required: boolean;
};

/**
 * Decide which build tools an environment requires.
 *
 * The three coarse flags select a preset, in increasing order of breadth. An explicit `buildTools.preset` replaces that choice, and the individual tool flags then override the preset. This is a pure function of the argument and performs no builds.
 */
export function selectBuildTools(
	arg: BuildToolsSelectionArg,
): BuildToolsSelection {
	const {
		buildTools: overrides = {},
		developmentTools = false,
		extended = true,
		pkgConfig = true,
	} = arg;

	// Determine the preset implied by the coarse flags. These are deliberately not exclusive: each one that is set widens the selection.
	let implied: Preset | undefined = undefined;
	if (pkgConfig) {
		implied = "minimal";
	}
	if (extended) {
		implied = "autotools";
	}
	if (developmentTools) {
		implied = "autotools-dev";
	}

	// An override may request tools even when every coarse flag is off.
	const hasOverrides = Object.keys(overrides).length > 0;
	const required = implied !== undefined || hasOverrides;
	const preset = overrides.preset ?? implied ?? "minimal";
	const selectionArg: BuildToolsOverrides = { ...overrides, preset };
	const config = resolveBuildToolsConfig(selectionArg);

	// Compare the resolved sets rather than the preset names, so that an override which does not actually change the selection still reaches the prebuilt artifact.
	const matchesAutotoolsPreset = buildToolsConfigEquals(
		config,
		autotoolsPresetConfig(),
	);

	return { arg: selectionArg, config, matchesAutotoolsPreset, required };
}

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
export async function env(arg: EnvArg): Promise<std.env.Arg> {
	const {
		build: build_,
		buildTools: buildToolsArg,
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
	const envs: tg.Args<std.env.Arg> = [];

	// Add compiler flags.
	flags(
		{
			host,
			...(fortifySource !== undefined ? { fortifySource } : {}),
			...(fullRelro !== undefined ? { fullRelro } : {}),
			...(hardeningCFlags !== undefined ? { hardeningCFlags } : {}),
			...(march !== undefined ? { march } : {}),
			...(mtune !== undefined ? { mtune } : {}),
			...(opt !== undefined ? { opt } : {}),
			...(pipe !== undefined ? { pipe } : {}),
			...(stripExecutables !== undefined ? { stripExecutables } : {}),
		},
		envs,
	);

	// `"none"` is the only way to obtain an environment without a compiler. The build tools selection below decides which tools accompany the SDK, never whether an SDK is added at all.
	if (sdkArg !== "none") {
		// Set up the native SDK for the build machine. A resolved `sdkArg` always
		// carries a concrete `target`, so pin it alongside the host - otherwise the
		// incoming target leaks through and produces an unwanted cross SDK.
		const sdkHost = canUsePrebuiltBuildTools ? detectedHost : build;
		const sdk =
			sdkArg !== undefined
				? await tg
						.build(std.sdk, sdkArg, { host: sdkHost, target: sdkHost })
						.named("sdk")
				: await tg.build(std.sdk, { host: sdkHost }).named("sdk");
		envs.push(sdk);

		const selection = selectBuildTools({
			...(buildToolsArg !== undefined ? { buildTools: buildToolsArg } : {}),
			developmentTools,
			extended,
			pkgConfig,
		});
		if (selection.required) {
			let buildToolsEnv: tg.Unresolved<std.env.Arg>;
			// Use the pre-built std.buildAutotoolsBuildTools whenever the selection resolves to the same set of tools that preset produces.
			if (selection.matchesAutotoolsPreset && canUsePrebuiltBuildTools) {
				buildToolsEnv = await tg
					.build(std.buildAutotoolsBuildTools)
					.named("autotools build tools");
			} else {
				// For other selections or when build machine differs, build with explicit parameters.
				buildToolsEnv = await tg
					.build(buildTools, {
						host: build,
						buildToolchain: sdk,
						...selection.arg,
					})
					.named("build tools");
			}
			envs.push(buildToolsEnv);
		}

		// Add a cross SDK if necessary.
		if (isCross) {
			// SDK runs on `build`, produces code for `host`.
			const crossSdk = await tg
				.build(std.sdk, ...(sdkArg !== undefined ? [sdkArg] : []), {
					host: build,
					target: host,
				})
				.named("cross sdk");
			envs.push(crossSdk);
		}
	}

	// Include any user-defined env with higher precedence.
	return std.env.compose(...envs, userEnv ?? null);
}

export async function testBuildToolsPresets() {
	// The preset table itself, so that a change to it is visible here first.
	const autotools = resolveBuildToolsConfig({ preset: "autotools" });
	tg.assert(
		autotools.m4 &&
			autotools.bison &&
			autotools.flex &&
			autotools.perl &&
			autotools.gettext,
		"the autotools preset provides the autotools prerequisites",
	);
	tg.assert(
		!autotools.libtool &&
			!autotools.texinfo &&
			!autotools.autoconf &&
			!autotools.help2man &&
			!autotools.automake,
		"the autotools preset omits the development tools",
	);

	const toolchain = resolveBuildToolsConfig({ preset: "toolchain" });
	tg.assert(toolchain.python, "the toolchain preset provides python");
	tg.assert(!toolchain.gettext, "the toolchain preset omits gettext");

	const minimal = resolveBuildToolsConfig({ preset: "minimal" });
	tg.assert(minimal.pkgConfig, "the minimal preset provides pkg-config");
	tg.assert(!minimal.m4, "the minimal preset provides nothing else");

	return true;
}

export async function testBuildToolsOverridesBeatPreset() {
	const config = resolveBuildToolsConfig({
		preset: "autotools-dev",
		texinfo: false,
	});
	tg.assert(!config.texinfo, "an individual flag overrides the preset");
	tg.assert(config.automake, "the rest of the preset is untouched");
	return true;
}

export async function testBuildToolsSelectionPresets() {
	// The coarse flags widen the selection in order, and are deliberately not exclusive.
	tg.assert(
		selectBuildTools({}).arg.preset === "autotools",
		"the default selection is the autotools preset",
	);
	tg.assert(
		selectBuildTools({ developmentTools: true }).arg.preset === "autotools-dev",
		"development tools select the autotools-dev preset",
	);
	tg.assert(
		selectBuildTools({ extended: false }).arg.preset === "minimal",
		"disabling the extended tools falls back to the minimal preset",
	);

	// Disabling pkg-config alone does not narrow the selection, because a wider flag is still set. The preset then turns pkg-config back on.
	const pkgConfigOff = selectBuildTools({ pkgConfig: false });
	tg.assert(
		pkgConfigOff.arg.preset === "autotools" && pkgConfigOff.config.pkgConfig,
		"disabling pkg-config alone has no effect while the extended tools are requested",
	);

	// With every coarse flag off and no overrides, no build tools are required at all.
	tg.assert(
		!selectBuildTools({ pkgConfig: false, extended: false }).required,
		"no build tools are required when every flag is off",
	);

	return true;
}

export async function testBuildToolsSelectionKeepsPrebuilt() {
	tg.assert(
		selectBuildTools({}).matchesAutotoolsPreset,
		"the default selection uses the prebuilt artifact",
	);
	tg.assert(
		selectBuildTools({ buildTools: { preset: "autotools" } })
			.matchesAutotoolsPreset,
		"requesting the autotools preset explicitly still uses the prebuilt artifact",
	);

	// An override that does not change the resolved set must not cost a rebuild. texinfo is already absent from the autotools preset.
	tg.assert(
		selectBuildTools({ buildTools: { texinfo: false } }).matchesAutotoolsPreset,
		"an override that changes nothing still uses the prebuilt artifact",
	);

	tg.assert(
		!selectBuildTools({ developmentTools: true }).matchesAutotoolsPreset,
		"a wider selection cannot use the prebuilt artifact",
	);

	return true;
}

export async function testBuildToolsSelectionOverrides() {
	// The granular escape hatch: the autotools preset plus one development tool, without the rest.
	const selection = selectBuildTools({ buildTools: { autoconf: true } });
	tg.assert(selection.config.autoconf, "the requested tool is selected");
	tg.assert(
		!selection.config.texinfo &&
			!selection.config.automake &&
			!selection.config.libtool &&
			!selection.config.help2man,
		"the other development tools are not dragged in",
	);
	tg.assert(
		selection.arg.autoconf === true,
		"the override is forwarded to buildTools",
	);
	tg.assert(
		!selection.matchesAutotoolsPreset,
		"a selection that adds a tool cannot use the prebuilt artifact",
	);
	return true;
}

export async function test() {
	await Promise.all([
		testBuildToolsPresets(),
		testBuildToolsOverridesBeatPreset(),
		testBuildToolsSelectionPresets(),
		testBuildToolsSelectionKeepsPrebuilt(),
		testBuildToolsSelectionOverrides(),
	]);
	return true;
}
