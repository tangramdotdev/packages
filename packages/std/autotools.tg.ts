import * as std from "./tangram.ts";

export type Arg = {
	/** The machine performing the compilation. */
	build?: string | null;

	/** Dependencies configuration. When provided, deps are resolved to env automatically. */
	deps?: std.deps.ConfigArg | null;

	/** Dependency argument overrides. Keys must match deps config keys. */
	dependencies?: std.args.DependencyArgs | null;

	/** By default, autotools builds compile "out-of-tree", creating build artifacts in a mutable working directory but referring to an immutable source. Enabling `buildInTree` will instead first copy the source directory into the working build directory. Default: false. */
	buildInTree?: boolean;

	/** Granular control over the individual build tools. A `preset` given here replaces the preset implied by `pkgConfig`, `extended`, and `developmentTools`, and the individual tool flags then override that preset. */
	buildTools?: std.dependencies.BuildToolsOverrides | null;

	/** If the build requires network access, provide a checksum or the string "any" to accept any result. */
	checksum?: tg.Checksum | null;

	/** Debug mode will enable additional log output, allow failures in subprocesses, and include a folder of logs at ${tg.output}/.tangram_logs. Default: false */
	debug?: boolean;

	/** Should we automatically add configure flags to support cross compilation when build !== host? If false, you must provide the necessary configuration manually. Default: true. */
	defaultCrossArgs?: boolean;

	/** Should we automatically set `CC`, `CXX`, and `AR` to the cross toolchain when build !== host? These are defaults - anything given in `env` takes precedence. If false, you must provide the necessary environment manually. Default: true. */
	defaultCrossEnv?: boolean;

	/** Should the development environment include `texinfo`, `help2man`, `autoconf` and `automake`? Default: false. */
	developmentTools?: boolean;

	/** Should we run the check phase? Default: false */
	doCheck?: boolean;

	/** Any environment to add to the build. */
	env?: std.env.Arg | null;

	/** Should the build environment include `m4`, `bison`, `perl`, and `gettext`? Default: true. */
	extended?: boolean;

	/** Should the flags include FORTIFY_SOURCE? `false` will disable, `true` will default to 3, values less than 0 or greater than 3 will throw an error. Default: 3.  */
	fortifySource?: boolean | number | null;

	/** Use full RELRO? Will use partial if disabled. May cause long start-up times in large programs. Default: true. */
	fullRelro?: boolean;

	/** Should we add the extra set of hardening CFLAGS? Default: true. */
	hardeningCFlags?: boolean;

	/** The machine the build output will run on. */
	host?: string | null;

	/** The value to pass to `-march` in the default CFLAGS. Default: undefined. */
	march?: string | null;

	/** The value to pass to `-mtune` in the default CFLAGS. Default: "generic". */
	mtune?: string | null;

	/** A name for the build process. */
	processName?: string | null;

	/** Should this build have network access? Must set a checksum to enable. Default: false. */
	network?: boolean;

	/** Should we normalize the prefix written to pkg-config files? Default: true. */
	normalizePkgConfigPrefix?: boolean;

	/** The optlevel to pass. Defaults to "2" */
	opt?: "1" | "2" | "3" | "s" | "z" | "fast" | null;

	/** Override the default phase order. Default: ["prepare", "configure", "build", "check", "install", "fixup"]. */
	order?: Array<string> | null;

	/** Should make jobs run in parallel? Default: false until new branch. */
	parallel?: boolean | number | null;

	/** Override the phases. Can be a single Arg or array of Args. */
	phases?: std.phases.Arg | Array<std.phases.Arg> | null;

	/** Compile with `-pipe`? This option allows the compiler to use pipes instead of temporary files internally, speeding up compilation at the cost of increased memory. Disable if compiling in low-memory environments. This has no effect on the output. Default: true. */
	pipe?: boolean;

	/** Should the build environment include pkg-config? Default: true */
	pkgConfig?: boolean;

	/** The argument configuring the installation prefix. Default value is `--prefix=${prefixPath}` Set to `"none"` to omit an installation destination argument.*/
	prefixArg?: tg.Template.Arg | "none" | null;

	/** The filepath to use as the installation prefix. Usually the default is what you want here. */
	prefixPath?: tg.Template.Arg | null;

	/** Should we remove all Libtool archives from the output directory? The presence of these files can cause downstream builds to depend on absolute paths which may no longer be valid, and can interfere with cross-compilation. Tangram uses other methods for library resolution, rendering these files unnecessary, and in some cases detrimental. Default: true. */
	removeLibtoolArchives?: boolean;

	/** Arguments for the SDK. Pass `"none"` to add no toolchain, build tools, or standard utilities, in which case `env` must provide everything the build needs. A null clears any arguments merged from earlier args and falls back to the default SDK. */
	sdk?: std.sdk.Arg | null;

	/** Should we mirror the contents `LIBRARY_PATH` in `LD_LIBRARY_PATH`/`DYLD_LIBRARY_PATH`? Default: false */
	setRuntimeLibraryPath?: boolean;

	/** Environment to propagate to all dependencies in the subtree. */
	subtreeEnv?: std.env.Arg | null;

	/** SDK configuration to propagate to all dependencies in the subtree. */
	subtreeSdk?: std.sdk.Arg | null;

	/** The source to build, which must be an autotools binary distribution bundle. This means there must be a configure script in the root of the source code. If necessary, autoreconf must be run before calling this function. */
	source?: tg.Directory | null;

	/** Should executables be stripped? Default is true. */
	stripExecutables?: boolean;
};

export async function build(...args: tg.Args<Arg>): Promise<tg.Directory> {
	const resolved = await arg(...args);

	// If deps were provided, resolve them to env.
	let depsEnv = resolved.env;
	const depsConfig = await std.deps.resolveConfig(resolved.deps);
	if (depsConfig) {
		// The resolved argument already satisfies `ContextArg`, and `deps.context` drops the
		// fields that are null or unset, so it may be forwarded directly.
		depsEnv = await std.deps.env(depsConfig, {
			...resolved,
			...std.args.optional("env", depsEnv),
		});
	}

	// For the top-level package, the subtree SDK applies to this build as well, and the build's own argument takes precedence.
	const effectiveSdk = await std.sdk.mergeArg(
		resolved.subtreeSdk,
		resolved.sdk,
	);

	const {
		build,
		buildInTree = false,
		buildTools,
		checksum,
		debug = false,
		defaultCrossArgs = true,
		defaultCrossEnv = true,
		developmentTools = false,
		doCheck = false,
		env: userEnv,
		fortifySource: fortifySource_ = 2,
		fullRelro = true,
		extended = true,
		hardeningCFlags = true,
		host,
		march,
		mtune = "generic",
		processName,
		network = false,
		normalizePkgConfigPrefix = true,
		opt = "2",
		order,
		parallel = true,
		pipe = true,
		phases: userPhaseArgs,
		pkgConfig = true,
		prefixArg = `--prefix=`,
		prefixPath = tg`${tg.output}`,
		removeLibtoolArchives = true,
		setRuntimeLibraryPath = false,
		source,
		stripExecutables = true,
	} = { ...resolved, env: depsEnv };
	const isCross = build !== host;
	const hostOs = std.triple.os(host);

	// Set up env.
	let envs: tg.Args<std.env.Arg> = [];

	// Add C/C++ compiler environment (flags, SDK, build tools).
	const ccEnv = await std.cc.env({
		host,
		build,
		...std.args.optional("buildTools", buildTools),
		developmentTools,
		extended,
		fortifySource: fortifySource_ ?? 2,
		fullRelro,
		hardeningCFlags,
		...std.args.optional("march", march),
		mtune: mtune ?? "generic",
		opt: opt ?? "2",
		pipe,
		pkgConfig,
		...(effectiveSdk !== undefined ? { sdk: effectiveSdk } : {}),
		stripExecutables,
	});
	envs.push(ccEnv);

	// When cross-compiling, point the standard tool variables at the cross toolchain. The toolchain prefix is the canonical host triple, where the output runs.
	if (defaultCrossEnv && isCross) {
		const hostPrefix = `${std.sdkModule.sdk.canonicalTriple(host)}-`;
		envs.push({
			CC: `${hostPrefix}cc`,
			CXX: `${hostPrefix}c++`,
			AR: `${hostPrefix}ar`,
		});
	}

	// Include any user-defined env with higher precedence than the SDK and autotools settings. A build that brings its own toolchain also brings its own utilities, so only a build with an SDK gets the standard set.
	const env =
		effectiveSdk === "none"
			? await std.env.compose(...envs, userEnv ?? null)
			: await std.env.arg(...envs, userEnv ?? null);

	// Define default phases.
	const configureArgs =
		prefixArg !== "none" ? [tg`${prefixArg}${prefixPath}`] : [];

	if (defaultCrossArgs) {
		if (isCross) {
			configureArgs.push(tg`--build=${build}`);
			configureArgs.push(tg`--host=${host}`);
		}
	}

	const defaultConfigurePath = buildInTree ? "." : source;
	const defaultConfigure = {
		command: tg`${defaultConfigurePath}/configure`,
		args: configureArgs,
	};

	const jobs = parallel ? (hostOs === "darwin" ? "8" : "$(nproc)") : "1";
	const jobsArg = `-j${jobs}`;
	const defaultBuild = {
		command: `make`,
		args: [jobsArg],
	};

	const defaultInstall = {
		command: `make`,
		args: [`install`],
	};

	// Build prepare phase command if needed.
	let defaultPrepareCommand = tg.template();
	if (buildInTree) {
		defaultPrepareCommand = tg`${defaultPrepareCommand}\ncp -R ${source}/. . && chmod -R u+w .`;
	}
	if (setRuntimeLibraryPath) {
		const os = std.triple.os(host);
		const runtimeLibEnvVar =
			os === "darwin" ? "DYLD_FALLBACK_LIBRARY_PATH" : "LD_LIBRARY_PATH";
		defaultPrepareCommand = tg`
			${defaultPrepareCommand}
			export ${runtimeLibEnvVar}=$LIBRARY_PATH
		`;
	}
	const needsPrepare = buildInTree || setRuntimeLibraryPath;

	// Build fixup phase command if needed.
	let defaultFixupCommand = tg.template();
	if (removeLibtoolArchives) {
		defaultFixupCommand = tg`${defaultFixupCommand}\nfind ${tg.output} -name '*.la' -delete`;
	}
	if (debug) {
		defaultFixupCommand = tg`${defaultFixupCommand}\nmkdir -p "$LOGDIR" && cp config.log "$LOGDIR/config.log"`;
	}
	if (normalizePkgConfigPrefix) {
		const pkgconfigFixup = await std.pkgconfig.shellNormalizeCommand();
		defaultFixupCommand = tg`${defaultFixupCommand}\n${pkgconfigFixup}`;
	}
	const needsFixup = debug || removeLibtoolArchives || normalizePkgConfigPrefix;

	// Assemble default phases.
	const defaultPhases = {
		configure: defaultConfigure,
		build: defaultBuild,
		install: defaultInstall,
		...(needsPrepare ? { prepare: { command: defaultPrepareCommand } } : {}),
		...(needsFixup ? { fixup: { command: defaultFixupCommand } } : {}),
		...(doCheck
			? { check: { command: `make`, args: [`check`, jobsArg] } }
			: {}),
	};

	// The build runs on the `build` machine.
	const system = std.triple.archAndOs(build);

	// Normalize user phases to array for merging.
	const userPhasesArray = Array.isArray(userPhaseArgs)
		? userPhaseArgs
		: userPhaseArgs !== undefined
			? [userPhaseArgs]
			: [];

	// Merge default phases with user phases.
	const mergedPhases = await std.phases.arg(defaultPhases, ...userPhasesArray);

	const result = std.phases.run({
		bootstrap: true,
		debug,
		phases: mergedPhases,
		env,
		host: system,
		checksum: checksum ?? null,
		network,
		order: order ?? null,
		processName: processName ?? null,
	});
	return await result.then(tg.Directory.expect);
}

/** The result of arg() - an Arg with build, host, and source guaranteed to be resolved. */
export type ResolvedArg = Omit<Arg, "build" | "host" | "phases" | "source"> & {
	build: string;
	host: string;
	/** User phases - either a single Arg or array of Args. Array form preserves mutations until merged with defaults. */
	phases?: std.phases.Arg | Array<std.phases.Arg>;
	source: tg.Directory;
};

/** Resolve autotools args to a mutable arg object. Returns an arg with build, host, and source guaranteed to be resolved. */
export async function arg(...args: tg.Args<Arg>): Promise<ResolvedArg> {
	type MergedArg = Omit<Arg, "phases"> & {
		phases: Array<std.phases.Arg>;
	};
	const merged = await tg.Args.apply<Arg, MergedArg, MergedArg>({
		args,
		map: async (arg) => {
			// Normalize phases to array, flattening if already an array.
			const phases = Array.isArray(arg.phases)
				? arg.phases
				: arg.phases !== undefined && arg.phases !== null
					? [arg.phases]
					: [];
			return {
				...arg,
				phases,
			} as MergedArg;
		},
		reduce: {
			env: (a, b) => std.env.compose(a ?? null, b ?? null),
			phases: "append",
			sdk: (a, b) => std.sdk.mergeArg(a, b),
			subtreeEnv: (a, b) => std.env.compose(a ?? null, b ?? null),
			subtreeSdk: (a, b) => std.sdk.mergeArg(a, b),
		},
	});

	const {
		build: build_,
		host: host_,
		phases: phaseArgs = [],
		source,
		...rest
	} = merged;

	tg.assert(source !== undefined && source !== null, `source must be defined`);

	const host = host_ ?? std.triple.host();
	const build = build_ ?? host;

	// Don't pre-merge phases here. Return them as an array so mutations are
	// preserved until merged with defaults in build().
	const phases = phaseArgs.filter((p): p is std.phases.Arg => p !== undefined);

	return {
		build,
		host,
		phases,
		source,
		...rest,
	};
}
