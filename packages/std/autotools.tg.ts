import * as std from "./tangram.tg.ts";

export type Arg = {
	/** Should we provide an SDK automatically? If true, the toollchain must be provided explicitly. */
	bootstrapMode?: boolean;

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
	host?: tg.Triple.Arg;

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

	/** Arguments to use for the SDK, or `false` to disable completely. */
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;

	/** The source to build, which must be an autotools binary distribution bundle. This means there must be a configure script in the root of the source code. If necessary, autoreconf must be run before calling this function. */
	source: tg.Directory;

	/** Should executables be stripped? Default is true. */
	stripExecutables?: boolean;

	/** The computer this build produces executables for. */
	target?: tg.Triple.Arg;
};

export let target = async (...args: tg.Args<Arg>) => {
	type Apply = {
		bootstrapMode: boolean;
		buildInTree: boolean;
		debug: boolean;
		defaultCFlags: boolean;
		doCheck: boolean;
		fullRelro: boolean;
		hardeningCFlags: boolean;
		host: tg.Triple;
		target: tg.Triple;
		opt: "1" | "2" | "3" | "s" | "z" | "fast";
		parallel: boolean | number;
		phases: Array<std.phases.Arg>;
		prefixArg?: tg.Template.Arg | undefined;
		prefixPath: tg.Template.Arg;
		sdkArgs?: Array<std.sdk.Arg>;
		source: tg.Directory;
		stripExecutables: boolean;
	};

	let {
		bootstrapMode = false,
		buildInTree = false,
		debug = false,
		defaultCFlags = true,
		doCheck = false,
		hardeningCFlags = true,
		fullRelro = true,
		host: host_,
		target: target_,
		opt = 2,
		parallel = true,
		phases,
		prefixArg = `--prefix=`,
		prefixPath = `$OUTPUT`,
		sdkArgs,
		source,
		stripExecutables = true,
	} = await tg.Args.apply<Arg, Apply>(args, async (arg) => {
		if (arg === undefined) {
			return {};
		} else if (typeof arg === "object") {
			let object: tg.MutationMap<Apply> = {};
			let phasesArgs: Array<std.phases.Arg> = [];
			if (arg.bootstrapMode !== undefined) {
				object.bootstrapMode = arg.bootstrapMode;
			}
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
				object.host = tg.Mutation.is(arg.host) ? arg.host : tg.triple(arg.host);
			}
			if (arg.opt !== undefined) {
				object.opt = arg.opt;
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
				if (typeof arg.sdk === "boolean") {
					object.sdkArgs = tg.Mutation.unset();
				} else if (tg.Mutation.is(arg.sdk)) {
					object.sdkArgs = arg.sdk;
				} else {
					object.sdkArgs = await tg.Mutation.arrayAppend<std.sdk.Arg>(arg.sdk);
				}
			}
			if (arg.stripExecutables !== undefined) {
				object.stripExecutables = arg.stripExecutables;
			}
			if (arg.target !== undefined) {
				object.target = tg.Mutation.is(arg.target)
					? arg.target
					: tg.triple(arg.target);
			}
			object.phases = await tg.Mutation.arrayAppend(phasesArgs);
			return object;
		} else {
			return tg.unreachable();
		}
	});

	// Make sure the the arguments provided a source.
	tg.assert(source !== undefined, `source must be defined`);

	// Detect the host system from the environment.
	let host = await tg.Triple.host(host_);
	let target = target_ ? tg.triple(target_) : host;
	let os = host.os;

	// Set up env.
	let env: std.env.Arg = {};

	// // C/C++ flags.
	let cflags = tg``;
	if (opt) {
		let optFlag = `-O${opt}`;
		cflags = tg`${cflags} ${optFlag}`;
	}
	if (defaultCFlags) {
		let defaultCFlags = `-mtune=generic -pipe`;
		cflags = tg`${cflags} ${defaultCFlags}`;
	}
	if (hardeningCFlags) {
		let extraCFlags = `-Wp,-U_FORTIFY_SOURCE,-D_FORTIFY_SOURCE=3 -fasynchronous-unwind-tables -fexceptions -fno-omit-frame-pointer -mno-omit-leaf-frame-pointer -fstack-protector-strong`;
		if (os === "linux") {
			extraCFlags = `${extraCFlags} -fstack-clash-protection`;
		}
		cflags = tg`${cflags} ${extraCFlags}`;
	}

	if (!host.environment || host.environment === "gnu") {
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

	if (!bootstrapMode) {
		// Set up the SDK, add it to the environment.
		let sdk = await std.sdk({ host, target }, sdkArgs);
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

	let system = tg.Triple.archAndOs(host);
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
