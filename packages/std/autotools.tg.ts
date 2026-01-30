import * as std from "./tangram.ts";

export type Arg = {
	/** Bootstrap mode will disable adding any implicit package builds like the SDK and standard utils. All dependencies must be explicitly provided via `env`. Default: false. */
	bootstrap?: boolean | undefined;

	/** The machine performing the compilation. */
	build?: string | undefined;

	/** Dependencies configuration. When provided, deps are resolved to env automatically. */
	deps?: std.deps.ConfigArg | undefined;

	/** Dependency argument overrides. Keys must match deps config keys. */
	dependencies?: std.args.DependencyArgs | undefined;

	/** By default, autotools builds compile "out-of-tree", creating build artifacts in a mutable working directory but referring to an immutable source. Enabling `buildInTree` will instead first copy the source directory into the working build directory. Default: false. */
	buildInTree?: boolean | undefined;

	/** If the build requires network access, provide a checksum or the string "any" to accept any result. */
	checksum?: tg.Checksum | undefined;

	/** Debug mode will enable additional log output, allow failures in subprocesses, and include a folder of logs at ${tg.output}/.tangram_logs. Default: false */
	debug?: boolean | undefined;

	/** Should we automatically add configure flags to support cross compilation when build !== host? If false, you must provide the necessary configuration manually. Default: true. */
	defaultCrossArgs?: boolean | undefined;

	/** Should we automatically set environment variables pointing to a cross toolchain when build !== host? If false, you must provide the necessary environment manually. Default: true. */
	defaultCrossEnv?: boolean | undefined;

	/** Should the development environment include `texinfo`, `help2man`, `autoconf` and `automake`? Default: false. */
	developmentTools?: boolean | undefined;

	/** Should we run the check phase? Default: false */
	doCheck?: boolean | undefined;

	/** Any environment to add to the build. */
	env?: std.env.Arg | undefined;

	/** Should the build environment include `m4`, `bison`, `perl`, and `gettext`? Default: true. */
	extended?: boolean | undefined;

	/** Should the flags include FORTIFY_SOURCE? `false` will disable, `true` will default to 3, values less than 0 or greater than 3 will throw an error. Default: 3.  */
	fortifySource?: boolean | number | undefined;

	/** Use full RELRO? Will use partial if disabled. May cause long start-up times in large programs. Default: true. */
	fullRelro?: boolean | undefined;

	/** Should we add the extra set of hardening CFLAGS? Default: true. */
	hardeningCFlags?: boolean | undefined;

	/** The machine the build output will run on. */
	host?: string | undefined;

	/** The value to pass to `-march` in the default CFLAGS. Default: undefined. */
	march?: string | undefined;

	/** The value to pass to `-mtune` in the default CFLAGS. Default: "generic". */
	mtune?: string | undefined;

	/** A name for the build process. */
	processName?: string | undefined;

	/** Should this build have network access? Must set a checksum to enable. Default: false. */
	network?: boolean | undefined;

	/** Should we normalize the prefix written to pkg-config files? Default: true. */
	normalizePkgConfigPrefix?: boolean | undefined;

	/** The optlevel to pass. Defaults to "2" */
	opt?: "1" | "2" | "3" | "s" | "z" | "fast" | undefined;

	/** Override the default phase order. Default: ["prepare", "configure", "build", "check", "install", "fixup"]. */
	order?: Array<string> | undefined;

	/** Should make jobs run in parallel? Default: false until new branch. */
	parallel?: boolean | number | undefined;

	/** Override the phases. Can be a single Arg or array of Args. */
	phases?: std.phases.Arg | Array<std.phases.Arg> | undefined;

	/** Compile with `-pipe`? This option allows the compiler to use pipes instead of temporary files internally, speeding up compilation at the cost of increased memory. Disable if compiling in low-memory environments. This has no effect on the output. Default: true. */
	pipe?: boolean | undefined;

	/** Should the build environment include pkg-config? Default: true */
	pkgConfig?: boolean | undefined;

	/** The argument configuring the installation prefix. Default value is `--prefix=${prefixPath}` Set to `"none"` to omit an installation destination argument.*/
	prefixArg?: tg.Template.Arg | "none" | undefined;

	/** The filepath to use as the installation prefix. Usually the default is what you want here. */
	prefixPath?: tg.Template.Arg | undefined;

	/** Should we remove all Libtool archives from the output directory? The presence of these files can cause downstream builds to depend on absolute paths which may no longer be valid, and can interfere with cross-compilation. Tangram uses other methods for library resolution, rendering these files unnecessary, and in some cases detrimental. Default: true. */
	removeLibtoolArchives?: boolean | undefined;

	/** Arguments to use for the SDK. */
	sdk?: std.sdk.Arg | undefined;

	/** Should we mirror the contents `LIBRARY_PATH` in `LD_LIBRARY_PATH`/`DYLD_LIBRARY_PATH`? Default: false */
	setRuntimeLibraryPath?: boolean | undefined;

	/** Environment to propagate to all dependencies in the subtree. */
	subtreeEnv?: std.env.Arg;

	/** SDK configuration to propagate to all dependencies in the subtree. */
	subtreeSdk?: std.sdk.Arg | undefined;

	/** The source to build, which must be an autotools binary distribution bundle. This means there must be a configure script in the root of the source code. If necessary, autoreconf must be run before calling this function. */
	source?: tg.Directory | undefined;

	/** Should executables be stripped? Default is true. */
	stripExecutables?: boolean | undefined;
};

export async function build(...args: std.Args<Arg>): Promise<tg.Directory> {
	const resolved = await arg(...args);

	// If deps were provided, resolve them to env.
	let depsEnv = resolved.env;
	const depsConfig = await std.deps.resolveConfig(resolved.deps);
	if (depsConfig) {
		depsEnv = await std.deps.env(depsConfig, {
			build: resolved.build,
			host: resolved.host,
			sdk: resolved.sdk,
			dependencies: resolved.dependencies,
			env: depsEnv,
			subtreeEnv: resolved.subtreeEnv,
			subtreeSdk: resolved.subtreeSdk,
		});
	}

	// For top-level package, merge subtreeSdk with sdk (sdk takes precedence).
	const effectiveSdk = await std.sdk.arg(resolved.subtreeSdk, resolved.sdk);

	const {
		bootstrap = false,
		build,
		buildInTree = false,
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
	// Use the effective SDK that merges subtreeSdk with sdk.
	const sdkArg_ = effectiveSdk;
	const isCross = build !== host;
	const hostOs = std.triple.os(host);

	// Set up env.
	let envs: std.Args<std.env.Arg> = [];
	if (bootstrap) {
		// Prevent automatically adding the utils to the env.
		envs.push({ utils: false });
	}

	// Add C/C++ compiler environment (flags, SDK, build tools).
	const ccEnv = await std.cc.env({
		host,
		build,
		bootstrap,
		developmentTools,
		extended,
		fortifySource: fortifySource_,
		fullRelro,
		hardeningCFlags,
		march,
		mtune,
		opt,
		pipe,
		pkgConfig,
		sdk: sdkArg_,
		stripExecutables,
	});
	envs.push(ccEnv);

	// Include any user-defined env with higher precedence than the SDK and autotools settings.
	const env = await std.env.arg(...envs, userEnv);

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
		defaultPrepareCommand = tg`${defaultPrepareCommand}\nmkdir work\ncp -R ${source}/. ./work && chmod -R u+w work\ncd work`;
	}
	if (setRuntimeLibraryPath) {
		const os = std.triple.os(host);
		const runtimeLibEnvVar =
			os === "darwin" ? "DYLD_FALLBACK_LIBRARY_PATH" : "LD_LIBRARY_PATH";
		defaultPrepareCommand = tg`${defaultPrepareCommand}\nexport ${runtimeLibEnvVar}=$LIBRARY_PATH`;
	}
	if (defaultCrossEnv && isCross) {
		// Toolchain prefix is the canonical host triple (where output runs).
		const canonicalHost = std.sdkModule.sdk.canonicalTriple(host);
		const hostPrefix = `${canonicalHost}-`;
		defaultPrepareCommand = tg`${defaultPrepareCommand}\nexport CC=${hostPrefix}cc && export CXX=${hostPrefix}c++ && export AR=${hostPrefix}ar`;
	}
	const needsPrepare = buildInTree || setRuntimeLibraryPath || defaultCrossEnv;

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

	let result = tg.build(std.phases.run, {
		bootstrap: true,
		debug,
		phases: mergedPhases,
		env,
		command: { env: { TANGRAM_HOST: system }, host: system },
		checksum,
		network,
		...(order !== undefined ? { order } : {}),
		...(processName !== undefined
			? { processName: `${processName} build` }
			: {}),
	});
	if (processName !== undefined) {
		result = result.named(processName);
	}
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
export const arg = async (...args: std.Args<Arg>): Promise<ResolvedArg> => {
	type Collect = std.args.MakeArrayKeys<Arg, "phases">;
	const collect = await std.args.apply<Arg, Collect>({
		args,
		map: async (arg) => {
			// Normalize phases to array, flattening if already an array.
			const phases = Array.isArray(arg.phases)
				? arg.phases
				: arg.phases !== undefined
					? [arg.phases]
					: [];
			return {
				...arg,
				phases,
			} as Collect;
		},
		reduce: {
			env: (a, b) => std.env.arg(a, b, { utils: false }),
			phases: "append",
			sdk: (a, b) => std.sdk.arg(a, b),
			subtreeEnv: (a, b) => std.env.arg(a, b, { utils: false }),
			subtreeSdk: (a, b) => std.sdk.arg(a, b),
		},
	});

	const {
		build: build_,
		host: host_,
		phases: phaseArgs = [],
		source,
		...rest
	} = collect;

	tg.assert(source !== undefined, `source must be defined`);

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
};
