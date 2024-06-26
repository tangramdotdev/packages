import * as std from "./tangram.tg.ts";

export type Arg = {
	/** By default, autotools builds compile "out-of-tree", creating build artifacts in a mutable working directory but referring to an immutable source. Enabling `buildInTree` will instead first copy the source directory into the working build directory. Default: false. */
	buildInTree?: boolean;

	/** If the build requires network access, provide a checksum or the string "unsafe" to accept any result. */
	checksum?: tg.Checksum;

	/** Debug mode will enable additional log output, allow failiures in subprocesses, and include a folder of logs at $OUTPUT/.tangram_logs. Default: false */
	debug?: boolean;

	/** Should we add the default CFLAGS? Will compile with `-mtune=generic -pipe`. Default: true */
	defaultCFlags?: boolean;

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

	/** Arguments to use for the SDK. Set `false` to omit an implicit SDK entirely, useful if you're passing a toolchain in explicitly via the `env` argument. Set `true` to use the default SDK configuration. */
	sdk?: std.sdk.Arg | boolean;

	/** The source to build, which must be an autotools binary distribution bundle. This means there must be a configure script in the root of the source code. If necessary, autoreconf must be run before calling this function. */
	source?: tg.Directory;

	/** Should executables be stripped? Default is true. */
	stripExecutables?: boolean;

	/** The computer this build produces executables for. */
	target?: string;
};

export let target = tg.target(async (...args: std.Args<Arg>) => {
	let mutationArgs = await std.args.createMutations<
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
	let {
		buildInTree = false,
		debug = false,
		defaultCFlags = true,
		doCheck = false,
		env: userEnv,
		fullRelro = true,
		hardeningCFlags = true,
		host: host_,
		march,
		mtune = "generic",
		opt = "2",
		parallel = true,
		phases,
		prefixArg = `--prefix=`,
		prefixPath = `$OUTPUT`,
		sdk: sdkArgs_,
		source,
		stripExecutables = true,
		target: target_,
	} = await std.args.applyMutations(mutationArgs);

	// Make sure the the arguments provided a source.
	tg.assert(source !== undefined, `source must be defined`);

	// Detect the host system from the environment.
	let host = host_ ?? (await std.triple.host());
	let target = target_ ?? host;
	let os = std.triple.os(host);

	// Determine SDK configuration.
	let sdkArgs: Array<std.sdk.ArgObject> | undefined = undefined;
	// If any SDk arg is `false`, we don't want to include the SDK.
	let includeSdk = !sdkArgs_?.some((arg) => arg === false);
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
	let cflags = tg``;
	if (opt) {
		let optFlag = `-O${opt}`;
		cflags = tg`${cflags} ${optFlag}`;
	}
	if (defaultCFlags) {
		let mArchFlag = march ? `-march=${march} ` : "";
		let mTuneFlag = mtune ? `-mtune=${mtune} ` : "";
		let defaultCFlags = `${mArchFlag}${mTuneFlag}-pipe`;
		cflags = tg`${cflags} ${defaultCFlags}`;
	}
	if (hardeningCFlags) {
		let extraCFlags = `-Wp,-U_FORTIFY_SOURCE,-D_FORTIFY_SOURCE=3 -fasynchronous-unwind-tables -fexceptions -fno-omit-frame-pointer -mno-omit-leaf-frame-pointer -fstack-protector-strong`;
		if (os === "linux") {
			extraCFlags = `${extraCFlags} -fstack-clash-protection`;
		}
		cflags = tg`${cflags} ${extraCFlags}`;
	}

	let environment = std.triple.environment(host);
	if (!environment || environment === "gnu") {
		let cc1Specs = tg.file(`
	 *cc1_options:
	 + %{!r:%{!fpie:%{!fPIE:%{!fpic:%{!fPIC:%{!fno-pic:-fPIE}}}}}}

	 *cpp_options:
	 + %{!r:%{!fpie:%{!fPIE:%{!fpic:%{!fPIC:%{!fno-pic:-fPIE}}}}}}
	 		`);
		let ldSpecs = tg.file(`
	 *self_spec:
	 + %{!static:%{!shared:%{!r:-pie}}}
	 		`);
		let extraCxxFlags = await tg.Mutation.prefix(
			`-Wp,-D_GLIBCXX_ASSERTIONS -specs=${cc1Specs} -specs=${ldSpecs}`,
			" ",
		);
		pushOrSet(env, "CXXFLAGS", extraCxxFlags);
	}
	pushOrSet(env, "CFLAGS", await cflags);
	pushOrSet(env, "CXXFLAGS", await cflags);

	// LDFLAGS
	if (stripExecutables === true) {
		let stripFlag = await tg.Mutation.prefix(
			os === "darwin" ? `-Wl,-S` : `-s`,
			" ",
		);
		pushOrSet(env, "LDFLAGS", stripFlag);
	}
	if (os === "linux" && hardeningCFlags) {
		let fullRelroString = fullRelro ? ",-z,now" : "";
		let extraLdFlags = await tg.Mutation.prefix(
			tg`-Wl,-z,relro${fullRelroString} -Wl,--as-needed`,
			" ",
		);
		pushOrSet(env, "LDFLAGS", extraLdFlags);
	}

	if (includeSdk) {
		// Set up the SDK, add it to the environment.
		let sdk = await std.sdk(sdkArgs);
		// Add a set of utils for the host, compiled with the default SDK to improve cache hits.
		let utils = await std.utils.env({
			host,
			sdk: false,
			env: std.sdk({ host }),
		});
		env = await std.env.arg(sdk, utils, env);
	}

	// If cross compiling, override CC/CXX to point to the correct compiler.
	if (host !== target) {
		env = await std.env.arg(env, {
			CC: `${target}-cc`,
			CXX: `${target}-c++`,
		});
	}

	// Include any user-defined env with higher precedence than the SDK and autotools settings.
	env = await std.env.arg(env, userEnv);

	// Define default phases.
	let configureArgs =
		prefixArg !== "none" ? [tg`${prefixArg}${prefixPath}`] : undefined;
	let defaultConfigurePath = buildInTree ? "." : source;
	let defaultConfigure = {
		command: tg`${defaultConfigurePath}/configure`,
		args: configureArgs,
	};

	let jobs = parallel ? (os === "darwin" ? "8" : "$(nproc)") : "1";
	let jobsArg = tg.Mutation.prefix(`-j${jobs}`, " ");
	let defaultBuild = {
		command: `make`,
		args: [jobsArg],
	};

	let defaultInstall = {
		command: `make`,
		args: [`install`],
	};

	let defaultPhases: tg.Unresolved<std.phases.PhasesArg> = {
		configure: defaultConfigure,
		build: defaultBuild,
		install: defaultInstall,
	};

	if (buildInTree) {
		let defaultPrepare = {
			command: tg`cp -R ${source}/. . && chmod -R u+w .`,
		};
		defaultPhases.prepare = defaultPrepare;
	}

	if (debug) {
		let defaultFixup = {
			command: `mkdir -p $LOGDIR && cp config.log $LOGDIR/config.log`,
		};
		defaultPhases.fixup = defaultFixup;
	}

	if (doCheck) {
		let defaultCheck = {
			command: `make`,
			args: [`check`, jobsArg],
		};
		defaultPhases.check = defaultCheck;
	}

	let system = std.triple.archAndOs(host);
	let phaseArgs = (phases ?? []).filter(
		(arg): arg is std.phases.Arg => arg !== undefined,
	);
	return await std.phases.target(
		{
			debug,
			phases: defaultPhases,
			env,
			target: { env: { TANGRAM_HOST: system }, host: system },
		},
		...phaseArgs,
	);
});

export let build = async (...args: std.args.UnresolvedArgs<Arg>) => {
	return await target(...args)
		.then((t) => t.output())
		.then(tg.Directory.expect);
};

export let pushOrSet = (
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
		let a = obj[key] as Array<tg.Value>;
		a.push(value);
		obj[key] = a;
	}
};
