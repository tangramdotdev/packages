import * as std from "./tangram.tg.ts";

export type Arg = {
	/** Should we provide an SDK automatically? If true, the toollchain must be provided explicitly. */
	bootstrapMode?: boolean;

	/** Should we add the default CFLAGS? Will compile with `-mtune=generic -pipe`. Default: true */
	defaultCFlags?: boolean;

	/** Should we run the check phase? Default: false */
	doCheck?: boolean;

	/** Should we add the extra set of CFLAGS? Will compile with `-Wp,-D_FORTIFY_SOURCE=3 -Wl,-z,relro -Wl,-as-needed -z defs -fno-omit-frame-pointer -mno-omit-leaf-frame-pointer -fstack-protector-strong -flto=auto -fPIE/-pie` Default: true*/
	extraCFlags?: boolean;

	/** Any environment to add to the target. */
	env?: std.env.Arg;

	/** The computer this build should get compiled on. */
	host?: std.Triple.Arg;

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
	target?: std.Triple.Arg;
};

export let target = async (...args: tg.Args<Arg>) => {
	type Apply = {
		bootstrapMode: boolean;
		defaultCFlags: boolean;
		doCheck: boolean;
		extraCFlags: boolean;
		host: std.Triple;
		target: std.Triple;
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
		defaultCFlags = true,
		doCheck = false,
		extraCFlags = false,
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
			if (arg.defaultCFlags !== undefined) {
				object.defaultCFlags = arg.defaultCFlags;
			}
			if (arg.extraCFlags !== undefined) {
				object.extraCFlags = arg.extraCFlags;
			}
			if (arg.doCheck !== undefined) {
				object.doCheck = arg.doCheck;
			}
			if (arg.env !== undefined) {
				phasesArgs.push({ env: arg.env });
			}
			if (arg.host !== undefined) {
				object.host = tg.Mutation.is(arg.host)
					? arg.host
					: std.triple(arg.host);
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
					: std.triple(arg.target);
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
	let host = await std.Triple.host(host_);
	let target = target_ ? std.triple(target_) : host;
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
	if (extraCFlags) {
		let extraCFlags = `-Wp,-U_FORTIFY_SOURCE,-D_FORTIFY_SOURCE=3 -fasynchronous-unwind-tables -fexceptions -fno-omit-frame-pointer -mno-omit-leaf-frame-pointer -fstack-protector-strong -fstack-clash-protection -flto=auto`;
		cflags = tg`${cflags} ${extraCFlags}`;
	}

	// 		if (host.environment === "gnu") {
	// 			let cc1Specs = tg.file(`
	// *cc1_options:
	// + %{!r:%{!fpie:%{!fPIE:%{!fpic:%{!fPIC:%{!fno-pic:-fPIE}}}}}}

	// *cpp_options:
	// + %{!r:%{!fpie:%{!fPIE:%{!fpic:%{!fPIC:%{!fno-pic:-fPIE}}}}}}
	// 		`);
	// 			let ldSpecs = tg.file(`
	// *self_spec:
	// + %{!static:%{!shared:%{!r:-pie}}}
	// 		`);
	// 			let extraCxxFlags = await tg.Mutation.templatePrepend(
	// 				`-Wp,-D_GLIBCXX_ASSERTIONS -specs=${cc1Specs} -specs=${ldSpecs}`,
	// 				" ",
	// 			);
	// 			pushOrSet(env, "CXXFLAGS", extraCxxFlags);
	// 		}
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
	if (extraCFlags) {
		let extraLdFlags = await tg.Mutation.templatePrepend(
			tg`-Wl,-z,relro -Wl,-as-needed`,
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
	let defaultConfigure = {
		command: tg`${source}/configure`,
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

	if (doCheck) {
		let defaultCheck = {
			command: `make`,
			args: [`check`, jobsArg],
		};
		defaultPhases.check = defaultCheck;
	}

	return await std.phases.target(
		{
			phases: defaultPhases,
			env: env,
			target: { host: std.Triple.system(host) },
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
