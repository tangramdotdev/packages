import * as std from "./tangram.ts";
import { buildTools, type Level } from "./sdk/dependencies.tg.ts";

export type Arg = {
	/** By default, autotools builds compile "out-of-tree", creating build artifacts in a mutable working directory but referring to an immutable source. Enabling `buildInTree` will instead first copy the source directory into the working build directory. Default: false. */
	buildInTree?: boolean;

	/** If the build requires network access, provide a checksum or the string "any" to accept any result. */
	checksum?: tg.Checksum;

	/** Debug mode will enable additional log output, allow failiures in subprocesses, and include a folder of logs at $OUTPUT/.tangram_logs. Default: false */
	debug?: boolean;

	/** Should we automatically add configure flags to support cross compilation when host !== target? If false, you must provide the necessary configuration manually. Default: true. */
	defaultCrossArgs?: boolean;

	/** Should we automatically set environment variables pointing to a cross toolchain when host !== target? If false, you must provide the necessary environment manually. Default: true. */
	defaultCrossEnv?: boolean;

	/** Should the development environment include `texinfo`, `help2man`, `autoconf` and `automake`? Default: false. */
	developmentTools?: boolean;

	/** Should we run the check phase? Default: false */
	doCheck?: boolean;

	/** Should the build environment include `m4`, `bison`, and `gettext`? Default: true. */
	extended?: boolean;

	/** Should we add the extra set of harderning CFLAGS? Default: true. */
	hardeningCFlags?: boolean;

	/** Any environment to add to the target. */
	env?: std.env.Arg;

	/** Should the flags include FORTIFY_SORUCE? `false` will disable, `true` will default to 3, values less than 0 or greater than 3 will throw an error. Default: 3.  */
	fortifySource?: boolean | number;

	/** Use full RELRO? Will use partial if disabled.  May cause long start-up times in large programs. Default: true. */
	fullRelro?: boolean;

	/** The computer this build should get compiled on. */
	host?: string;

	/** The value to pass to `-march` in the default CFLAGS. Default: undefined. */
	march?: string;

	/** The value to pass to `-mtune` in the default CFLAGS. Default: "generic". */
	mtune?: string;

	/** Should this build have network access? Must set a checksum to enable. Default: false. */
	network?: boolean;

	/** The optlevel to pass. Defaults to "2" */
	opt?: "1" | "2" | "3" | "s" | "z" | "fast" | undefined;

	/** Should make jobs run in parallel? Default: false until new branch. */
	parallel?: boolean | number;

	/** Compile with `-pipe`? This option allows the compiler to use pipes instead of tempory files internally, speeding up compilation at the cost of increased memory. Disable if compiling in low-memory environments. This has no effect on the output. Default: true. */
	pipe?: boolean;

	/** Should the build environment include pkg-config? Default: true */
	pkgConfig?: boolean;

	/** Override the phases. */
	phases?: std.phases.Arg;

	/** The argument configuring the installation prefix. Default value is `--prefix=${prefixPath}` Set to `"none"` to omit an installation destination argument.*/
	prefixArg?: tg.Template.Arg | "none";

	/** The filepath to use as the installation prefix. Usually the default is what you want here. */
	prefixPath?: tg.Template.Arg;

	/** Should we remove all Libtool archives from the output directory? The presence of these files can cause downstream builds to depend on absolute paths with may no longer be valid, and can interfere with cross-compilation. Tangram uses other methods for library resolution, rending these files unnecessary, and in some cases detrimental. Default: true. */
	removeLibtoolArchives?: boolean;

	/** Arguments to use for the SDK. Set `false` to omit an implicit SDK entirely, useful if you're passing a toolchain in explicitly via the `env` argument. Set `true` to use the default SDK configuration. */
	sdk?: std.sdk.Arg | boolean;

	/** Should we mirror the contents `LIBRARY_PATH` in `LD_LIBRARY_PATH`/`DYLD_LIBRARY_PATH`? Default: false */
	setRuntimeLibraryPath?: boolean;

	/** The source to build, which must be an autotools binary distribution bundle. This means there must be a configure script in the root of the source code. If necessary, autoreconf must be run before calling this function. */
	source?: tg.Directory;

	/** Should executables be stripped? Default is true. */
	stripExecutables?: boolean;

	/** The computer this build produces executables for. */
	target?: string;
};

export const build = tg.command(async (...args: std.Args<Arg>) => {
	const mutationArgs = await std.args.createMutations<
		Arg,
		std.args.MakeArrayKeys<Arg, "env" | "phases" | "sdk">
	>(std.flatten(args), {
		env: "append",
		phases: "append",
		sdk: (arg) => {
			if (arg === false) {
				return tg.Mutation.append(false);
			} else if (arg === true) {
				return tg.Mutation.append({});
			} else {
				return tg.Mutation.append<boolean | std.sdk.Arg>(arg as std.sdk.Arg);
			}
		},
		source: "set",
	});
	const {
		buildInTree = false,
		checksum,
		debug = false,
		defaultCrossArgs = true,
		defaultCrossEnv = true,
		developmentTools = false,
		doCheck = false,
		env: userEnv,
		fortifySource: fortifySource_ = 3,
		fullRelro = true,
		extended = true,
		hardeningCFlags = true,
		host: host_,
		march,
		mtune = "generic",
		network = false,
		opt = "2",
		parallel = true,
		pipe = true,
		phases,
		pkgConfig = true,
		prefixArg = `--prefix=`,
		prefixPath = `$OUTPUT`,
		removeLibtoolArchives = true,
		sdk: sdkArgs_,
		setRuntimeLibraryPath = false,
		source,
		stripExecutables = true,
		target: target_,
	} = await std.args.applyMutations(mutationArgs);

	// Make sure the the arguments provided a source.
	tg.assert(source !== undefined, `source must be defined`);

	// Detect the host system from the environment.
	const host = host_ ?? (await std.triple.host());
	const target = target_ ?? host;
	const os = std.triple.os(host);

	// Determine SDK configuration.
	let sdkArgs: Array<std.sdk.ArgObject> | undefined = undefined;
	// If any SDk arg is `false`, we don't want to include the SDK.
	const includeSdk = !sdkArgs_?.some((arg) => arg === false);
	// If we are including the SDK, omit any booleans from the array.
	if (includeSdk) {
		sdkArgs =
			sdkArgs_?.filter(
				(arg): arg is std.sdk.ArgObject => typeof arg !== "boolean",
			) ?? [];
		if (
			sdkArgs.length === 0 ||
			sdkArgs.every((arg) => arg?.host === undefined)
		) {
			sdkArgs = std.flatten([{ host, target }, sdkArgs]);
		}
	}

	// Set up env.
	let envs: tg.Unresolved<Array<std.env.Arg>> = [];

	// // C/C++ flags.
	if (opt) {
		envs.push({ CFLAGS: tg.Mutation.suffix(`-O${opt}`, " ") });
	}
	if (pipe) {
		envs.push({ CFLAGS: tg.Mutation.suffix("-pipe", " ") });
	}
	if (march !== undefined) {
		envs.push({ CFLAGS: tg.Mutation.suffix(`-march=${march}`, " ") });
	}
	if (mtune !== undefined) {
		envs.push({ CFLAGS: tg.Mutation.suffix(`-mtune=${mtune}`, " ") });
	}
	let fortifySource =
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

	if (hardeningCFlags) {
		let extraCFlags = `-fasynchronous-unwind-tables -fexceptions -fno-omit-frame-pointer -mno-omit-leaf-frame-pointer -fstack-protector-strong`;
		if (os === "linux") {
			extraCFlags = `${extraCFlags} -fstack-clash-protection`;
		}
		envs.push({ CFLAGS: tg.Mutation.suffix(extraCFlags, " ") });
	}

	const environment = std.triple.environment(host);
	if (!environment || environment === "gnu") {
		envs.push({
			CXXFLAGS: tg.Mutation.suffix("-Wp,-D_GLIBCXX_ASSERTIONS", " "),
		});
	}

	// LDFLAGS
	if (stripExecutables === true) {
		const stripFlag = os === "darwin" ? `-Wl,-S` : `-s`;
		envs.push({ LDFLAGS: tg.Mutation.suffix(stripFlag, " ") });
	}
	if (os === "linux" && hardeningCFlags) {
		const fullRelroString = fullRelro ? ",-z,now" : "";
		const extraLdFlags = `-Wl,-z,relro${fullRelroString} -Wl,--as-needed`;
		envs.push({ LDFLAGS: tg.Mutation.suffix(extraLdFlags, " ") });
	}

	if (includeSdk) {
		// Set up the SDK, add it to the environment.
		const sdk = await std.sdk(sdkArgs);
		// Add the requested set of utils for the host, compiled with the default SDK to improve cache hits.
		let level: Level = "base";
		if (pkgConfig) {
			level = "pkgconfig";
		}
		if (extended) {
			level = "extended";
		}
		if (developmentTools) {
			level = "devtools";
		}
		const buildToolsEnv = buildTools({
			host,
			buildToolchain: std.sdk({ host }),
			level,
		});
		envs.push(sdk, buildToolsEnv);
	}

	// Include any user-defined env with higher precedence than the SDK and autotools settings.
	const env = await std.env.arg(...envs, userEnv);

	// Define default phases.
	const configureArgs =
		prefixArg !== "none" ? [tg`${prefixArg}${prefixPath}`] : [];

	if (defaultCrossArgs) {
		if (host !== target) {
			configureArgs.push(tg`--build=${host}`);
			configureArgs.push(tg`--host=${target}`);
		}
	}

	const defaultConfigurePath = buildInTree ? "." : source;
	const defaultConfigure = {
		command: tg`${defaultConfigurePath}/configure`,
		args: configureArgs,
	};

	const jobs = parallel ? (os === "darwin" ? "8" : "$(nproc)") : "1";
	const jobsArg = tg.Mutation.prefix(`-j${jobs}`, " ");
	const defaultBuild = {
		command: `make`,
		args: [jobsArg],
	};

	const defaultInstall = {
		command: `make`,
		args: [`install`],
	};

	const defaultPhases: tg.Unresolved<std.phases.PhasesArg> = {
		configure: defaultConfigure,
		build: defaultBuild,
		install: defaultInstall,
	};

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

	if (defaultCrossEnv) {
		if (host !== target) {
			const targetPrefix = `${target}-`;
			defaultPrepareCommand = tg`${defaultPrepareCommand}\nexport CC=${targetPrefix}cc && export CXX=${targetPrefix}c++ && export AR=${targetPrefix}ar`;
		}
	}

	if (buildInTree || setRuntimeLibraryPath || defaultCrossEnv) {
		const defaultPrepare = {
			command: defaultPrepareCommand,
		};
		defaultPhases.prepare = defaultPrepare;
	}

	let defaultFixupCommand = tg.template();
	if (removeLibtoolArchives) {
		defaultFixupCommand = tg`${defaultFixupCommand}\nfind $OUTPUT -name '*.la' -delete`;
	}

	if (debug) {
		defaultFixupCommand = tg`${defaultFixupCommand}\nmkdir -p $LOGDIR && cp config.log $LOGDIR/config.log`;
	}

	if (debug || removeLibtoolArchives) {
		const defaultFixup = {
			command: defaultFixupCommand,
		};
		defaultPhases.fixup = defaultFixup;
	}

	if (doCheck) {
		const defaultCheck = {
			command: `make`,
			args: [`check`, jobsArg],
		};
		defaultPhases.check = defaultCheck;
	}

	const system = std.triple.archAndOs(host);
	const phaseArgs = (phases ?? []).filter(
		(arg): arg is std.phases.Arg => arg !== undefined,
	);
	return await std.phases
		.run(
			{
				debug,
				phases: defaultPhases,
				env,
				command: { env: { TANGRAM_HOST: system }, host: system },
				checksum,
				network,
			},
			...phaseArgs,
		)
		.then(tg.Directory.expect);
});
