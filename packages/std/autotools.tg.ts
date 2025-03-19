import * as std from "./tangram.ts";

export type Arg = {
	/** By default, autotools builds compile "out-of-tree", creating build artifacts in a mutable working directory but referring to an immutable source. Enabling `buildInTree` will instead first copy the source directory into the working build directory. Default: false. */
	buildInTree?: boolean;

	/** If the build requires network access, provide a checksum or the string "any" to accept any result. */
	checksum?: tg.Checksum;

	/** Debug mode will enable additional log output, allow failiures in subprocesses, and include a folder of logs at $OUTPUT/.tangram_logs. Default: false */
	debug?: boolean;

	/** Should we add the default CFLAGS? Will compile with `-mtune=generic -pipe`. Default: true */
	defaultCFlags?: boolean;

	/** Should we automatically add configure flags to support cross compilation when host !== target? If false, you must provide the necessary configuration manually. Default: true. */
	defaultCrossArgs?: boolean;

	/** Should we automatically set environment variables pointing to a cross toolchain when host !== target? If false, you must provide the necessary environment manually. Default: true. */
	defaultCrossEnv?: boolean;

	/** Should we run the check phase? Default: false */
	doCheck?: boolean;

	/** Should we add the extra set of harderning CFLAGS? Default: true*/
	hardeningCFlags?: boolean;

	/** Any environment to add to the target. */
	env?: std.env.Arg;

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
		defaultCFlags = true,
		defaultCrossArgs = true,
		defaultCrossEnv = true,
		doCheck = false,
		env: userEnv,
		fullRelro = true,
		hardeningCFlags = true,
		host: host_,
		march,
		mtune = "generic",
		network = false,
		opt = "2",
		parallel = true,
		phases,
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
	let env: std.env.Arg = {};

	// // C/C++ flags.
	let cflags = tg.template();
	if (opt) {
		const optFlag = `-O${opt}`;
		cflags = tg`${cflags} ${optFlag}`;
	}
	if (defaultCFlags) {
		const mArchFlag = march ? `-march=${march} ` : "";
		const mTuneFlag = mtune ? `-mtune=${mtune} ` : "";
		const defaultCFlags = `${mArchFlag}${mTuneFlag}-pipe`;
		cflags = tg`${cflags} ${defaultCFlags}`;
	}
	if (hardeningCFlags) {
		let extraCFlags = `-Wp,-U_FORTIFY_SOURCE,-D_FORTIFY_SOURCE=3 -fasynchronous-unwind-tables -fexceptions -fno-omit-frame-pointer -mno-omit-leaf-frame-pointer -fstack-protector-strong`;
		if (os === "linux") {
			extraCFlags = `${extraCFlags} -fstack-clash-protection`;
		}
		cflags = tg`${cflags} ${extraCFlags}`;
	}

	const environment = std.triple.environment(host);
	if (!environment || environment === "gnu") {
		const cc1Specs = tg.file(`
	 *cc1_options:
	 + %{!r:%{!fpie:%{!fPIE:%{!fpic:%{!fPIC:%{!fno-pic:-fPIE}}}}}}

	 *cpp_options:
	 + %{!r:%{!fpie:%{!fPIE:%{!fpic:%{!fPIC:%{!fno-pic:-fPIE}}}}}}
	 		`);
		const ldSpecs = tg.file(`
	 *self_spec:
	 + %{!static:%{!shared:%{!r:-pie}}}
	 		`);
		const extraCxxFlags = await tg.Mutation.prefix(
			`-Wp,-D_GLIBCXX_ASSERTIONS -specs=${cc1Specs} -specs=${ldSpecs}`,
			" ",
		);
		pushOrSet(env, "CXXFLAGS", extraCxxFlags);
	}
	pushOrSet(env, "CFLAGS", await cflags);
	pushOrSet(env, "CXXFLAGS", await cflags);

	// LDFLAGS
	if (stripExecutables === true) {
		const stripFlag = await tg.Mutation.prefix(
			os === "darwin" ? `-Wl,-S` : `-s`,
			" ",
		);
		pushOrSet(env, "LDFLAGS", stripFlag);
	}
	if (os === "linux" && hardeningCFlags) {
		const fullRelroString = fullRelro ? ",-z,now" : "";
		const extraLdFlags = await tg.Mutation.prefix(
			tg`-Wl,-z,relro${fullRelroString} -Wl,--as-needed`,
			" ",
		);
		pushOrSet(env, "LDFLAGS", extraLdFlags);
	}

	if (includeSdk) {
		// Set up the SDK, add it to the environment.
		const sdk = await std.sdk(sdkArgs);
		// Add a set of utils for the host, compiled with the default SDK to improve cache hits.
		const utils = await std.utils.env({
			host,
			sdk: false,
			env: std.sdk({ host }),
		});
		env = await std.env.arg(sdk, utils, env);
	}

	// Include any user-defined env with higher precedence than the SDK and autotools settings.
	env = await std.env.arg(env, userEnv);

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
		.build(
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

export const pushOrSet = (
	obj: { [key: string]: unknown },
	key: string,
	value: tg.Value,
) => {
	if (obj === undefined) {
		obj = {};
		obj[key] = value;
	} else if (obj[key] === undefined) {
		obj[key] = value;
	} else {
		if (!Array.isArray(obj[key])) {
			obj[key] = [obj[key]];
		}
		tg.assert(obj && key in obj && Array.isArray(obj[key]));
		const a = obj[key] as Array<tg.Value>;
		a.push(value);
		obj[key] = a;
	}
};
