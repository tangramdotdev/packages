import * as std from "./tangram.tg.ts";

export type Arg = {
	/** By default, autotools builds compile "out-of-tree", creating build artifacts in a mutable working directory but referring to an immutable source. Enabling `buildInTree` will instead first copy the source directory into the working build directory. Default: false. */
	buildInTree?: boolean;

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
	opt?: "1" | "2" | "3" | "s" | "z" | "fast";

	/** Should make jobs run in parallel? Default: false until new branch. */
	parallel?: boolean | number;

	/** Override the phases. */
	phases?: std.phases.Arg;

	/** The argument configuring the installation prefix. Default value is `--prefix=${prefixPath}` Set to `"none"` to omit an installation destination argument.*/
	prefixArg?: tg.Template.Arg | "none";

	/** The filepath to use as the installation prefix. Usually the default of `tg.ouput` is what you want here. */
	prefixPath?: tg.Template.Arg;

	/** Arguments to use for the SDK. Set `false` to omit an implicit SDK entirely, useful if you're passing a toolchain in explicitly via the `env` argument. Set `true` to use the default SDK configuration. */
	sdk?: boolean | tg.MaybeNestedArray<std.sdk.Arg>;

	/** The source to build, which must be an autotools binary distribution bundle. This means there must be a configure script in the root of the source code. If necessary, autoreconf must be run before calling this function. */
	source: tg.Directory;

	/** Should executables be stripped? Default is true. */
	stripExecutables?: boolean;

	/** The computer this build produces executables for. */
	target?: string;
};

export let target = async (...args: tg.Args<Arg>) => {
	type Apply = {
		buildInTree: boolean;
		debug: boolean;
		defaultCFlags: boolean;
		doCheck: boolean;
		fullRelro: boolean;
		hardeningCFlags: boolean;
		host: string;
		march: string;
		mtune: string;
		opt: "1" | "2" | "3" | "s" | "z" | "fast";
		parallel: boolean | number;
		phases: Array<std.phases.Arg>;
		prefixArg?: tg.Template.Arg | undefined;
		prefixPath: tg.Template.Arg;
		sdkArgs?: Array<boolean | std.sdk.Arg>;
		source: tg.Directory;
		stripExecutables: boolean;
		target: string;
	};

	let {
		buildInTree = false,
		debug = false,
		defaultCFlags = true,
		doCheck = false,
		fullRelro = true,
		hardeningCFlags = true,
		host: host_,
		march,
		mtune = "generic",
		opt = 2,
		parallel = true,
		phases,
		prefixArg = `--prefix=`,
		prefixPath = `$OUTPUT`,
		sdkArgs: sdkArgs_,
		source,
		stripExecutables = true,
		target: target_,
	} = await tg.Args.apply<Arg, Apply>(args, async (arg) => {
		if (arg === undefined) {
			return {};
		} else if (typeof arg === "object") {
			let object: tg.MutationMap<Apply> = {};
			let phasesArgs: Array<std.phases.Arg> = [];
			if (arg.buildInTree !== undefined) {
				object.buildInTree = arg.buildInTree;
			}
			if (arg.debug !== undefined) {
				object.debug = arg.debug;
			}
			if (arg.defaultCFlags !== undefined) {
				object.defaultCFlags = arg.defaultCFlags;
			}
			if (arg.hardeningCFlags !== undefined) {
				object.hardeningCFlags = arg.hardeningCFlags;
			}
			if (arg.doCheck !== undefined) {
				object.doCheck = arg.doCheck;
			}
			if (arg.env !== undefined) {
				phasesArgs.push({ env: arg.env });
			}
			if (arg.fullRelro !== undefined) {
				object.fullRelro = arg.fullRelro;
			}
			if (arg.host !== undefined) {
				object.host = arg.host;
			}
			if (arg.opt !== undefined) {
				object.opt = arg.opt;
			}
			if (arg.march !== undefined) {
				object.march = arg.march;
			}
			if (arg.mtune !== undefined) {
				object.mtune = arg.mtune;
			}
			if (arg.parallel !== undefined) {
				object.parallel = arg.parallel;
			}
			if (arg.prefixArg !== undefined) {
				object.prefixArg = arg.prefixArg;
			}
			if (arg.prefixPath !== undefined) {
				object.prefixPath = arg.prefixPath;
			}
			if (arg.source !== undefined) {
				object.source = arg.source;
			}
			if (arg.phases !== undefined) {
				if (tg.Mutation.is(arg.phases)) {
					object.phases = arg.phases;
				} else {
					phasesArgs.push(arg.phases);
				}
			}
			if (arg.sdk !== undefined) {
				if (tg.Mutation.is(arg.sdk)) {
					object.sdkArgs = arg.sdk;
				} else {
					if (typeof arg.sdk === "boolean") {
						if (arg.sdk === false) {
							// If the user set this to `false`, pass it through. Ignore `true`.
							object.sdkArgs = await tg.Mutation.arrayAppend<
								boolean | std.sdk.Arg
							>(false);
						}
					} else {
						object.sdkArgs = await tg.Mutation.arrayAppend<
							boolean | std.sdk.Arg
						>(arg.sdk);
					}
				}
			}
			if (arg.stripExecutables !== undefined) {
				object.stripExecutables = arg.stripExecutables;
			}
			if (arg.target !== undefined) {
				object.target = arg.target;
			}
			object.phases = await tg.Mutation.arrayAppend(phasesArgs);
			return object;
		} else {
			return tg.unreachable();
		}
	});

	// Make sure the the arguments provided a source.
	tg.assert(source !== undefined, `source must be defined`);

	// Determine SDK configuration.
	let sdkArgs: Array<std.sdk.Arg> | undefined = undefined;
	// If any SDk arg is `false`, we don't want to include the SDK.
	let includeSdk = !sdkArgs_?.some((arg) => arg === false);
	// If we are including the SDK, omit any booleans from the array.
	if (includeSdk) {
		sdkArgs =
			sdkArgs_?.filter((arg): arg is std.sdk.Arg => typeof arg !== "boolean") ??
			([] as Array<std.sdk.Arg>);
	}

	// Detect the host system from the environment.
	let host = host_ ?? (await std.triple.host());
	let target = target_ ?? host;
	let os = std.triple.os(host);

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
		let defaultCFlags = `${mArchFlag}-mtune=${mtune} -pipe`;
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
		let extraCxxFlags = await tg.Mutation.templatePrepend(
			`-Wp,-D_GLIBCXX_ASSERTIONS -specs=${cc1Specs} -specs=${ldSpecs}`,
			" ",
		);
		pushOrSet(env, "CXXFLAGS", extraCxxFlags);
	}
	pushOrSet(env, "CFLAGS", await cflags);
	pushOrSet(env, "CXXFLAGS", await cflags);

	// LDFLAGS
	if (stripExecutables === true) {
		let stripFlag = await tg.Mutation.templatePrepend(
			os === "darwin" ? `-Wl,-S` : `-s`,
			" ",
		);
		pushOrSet(env, "LDFLAGS", stripFlag);
	}
	if (os === "linux" && hardeningCFlags) {
		let fullRelroString = fullRelro ? ",-z,now" : "";
		let extraLdFlags = await tg.Mutation.templatePrepend(
			tg`-Wl,-z,relro${fullRelroString} -Wl,--as-needed`,
			" ",
		);
		pushOrSet(env, "LDFLAGS", extraLdFlags);
	}

	if (includeSdk) {
		// Set up the SDK, add it to the environment.
		let sdk = await std.sdk(sdkArgs);
		env = [sdk, env];
	}

	// Define default phases.
	let configureArgs =
		prefixArg !== "none" ? [tg`${prefixArg}${prefixPath}`] : undefined;
	let defaultConfigurePath = buildInTree ? "." : source;
	let defaultConfigure = {
		command: tg`${defaultConfigurePath}/configure`,
		args: configureArgs,
	};

	let jobs = parallel ? (os === "darwin" ? "8" : "$(nproc)") : "1";
	let jobsArg = tg.Mutation.templatePrepend(`-j${jobs}`, " ");
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
			command: tg`cp -RaT ${source}/. . && chmod -R u+w .`,
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
	return await std.phases.target(
		{
			debug,
			phases: defaultPhases,
			env,
			target: { env: { TANGRAM_HOST: system }, host: system },
		},
		...(phases ?? []),
	);
};

export let build = async (...args: tg.Args<Arg>) => {
	return tg.Directory.expect(await (await target(...args)).build());
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
