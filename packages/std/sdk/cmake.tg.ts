import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.tg.ts";
import ninja from "./ninja.tg.ts";

export let metadata = {
	homepage: "https://cmake.org/",
	license: "BSD-3-Clause",
	name: "cmake",
	repository: "https://gitlab.kitware.com/cmake/cmake",
	version: "3.29.6",
};

export let source = tg.target(() => {
	let { version } = metadata;
	let checksum =
		"sha256:1391313003b83d48e2ab115a8b525a557f78d8c1544618b48d1d90184a10f0af";
	let owner = "Kitware";
	let repo = "CMake";
	let tag = `v${version}`;
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		source: "release",
		tag,
		version,
	});
});

export type Arg = {
	build?: string | undefined;
	env?: std.env.Arg;
	host?: string | undefined;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

/** Build `cmake`. */
export let cmake = tg.target(async (arg?: Arg) => {
	let {
		build: build_,
		env: env_,
		host: host_,
		sdk,
		source: source_,
	} = arg ?? {};
	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;

	let sourceDir = source_ ?? source();

	let configure = {
		command: `./bootstrap`,
		args: [
			`--parallel=$(nproc)`,
			`--`,
			`-DCMAKE_USE_OPENSSL=OFF`,
			`-DBUILD_SHARED_LIBS=OFF`,
		],
	};

	let bootstrapSdk = await std.sdk(bootstrap.sdk.arg(host));
	let env = std.env.arg(
		bootstrapSdk,
		bootstrap.make.build(host),
		{
			CC: "cc -static",
			CXX: "c++ -static",
			TANGRAM_LINKER_PASSTHROUGH: true,
		},
		env_,
	);

	let result = std.autotools.build({
		...std.triple.rotate({ build, host }),
		buildInTree: true,
		env,
		phases: { configure },
		sdk: false,
		source: sourceDir,
	});

	return result;
});

export default cmake;

export type BuildArg = {
	/** Debug mode will enable additional log output, allow failiures in subprocesses, and include a folder of logs at $OUTPUT/.tangram_logs. Default: false */
	debug?: boolean;

	/** Should we add the default CFLAGS? Will compile with `-mtune=generic -pipe`. Default: true */
	defaultCFlags?: boolean;

	/** Any environment to add to the target. */
	env?: std.env.Arg;

	/** Use full RELRO? Will use partial if disabled.  May cause long start-up times in large programs. Default: true. */
	fullRelro?: boolean;

	/** Which generator to use. Default: "Ninja" */
	generator: "Ninja" | "Unix Makefiles";

	/** Should we add the extra set of harderning CFLAGS? Default: true*/
	hardeningCFlags?: boolean;

	/** The computer this build should get compiled on. */
	host?: string;

	/** The value to pass to `-march` in the default CFLAGS. Default: undefined. */
	march?: string;

	/** The value to pass to `-mtune` in the default CFLAGS. Default: undefined. */
	mtune?: string;

	/** The optlevel to pass. Defaults to "2" */
	opt?: "1" | "2" | "3" | "s" | "z" | "fast";

	/** Should make jobs run in parallel? Default: false until new branch. */
	parallel?: boolean | number;

	/** Override the phases. */
	phases?: std.phases.Arg;

	/** The filepath to use as the installation prefix. Usually the default is what you want here. */
	prefixPath?: tg.Template.Arg;

	/** Arguments to use for the SDK. Set `false` to omit an implicit SDK entirely, useful if you're passing a toolchain in explicitly via the `env` argument. Set `true` to use the default SDK configuration. */
	sdk?: std.sdk.Arg | boolean;

	/** The source to build, which must be an autotools binary distribution bundle. This means there must be a configure script in the root of the source code. If necessary, autoreconf must be run before calling this function. */
	source: tg.Template.Arg;

	/** Should executables be stripped? Default is true. */
	stripExecutables?: boolean;

	/** The computer this build produces executables for. */
	target?: string;
};

/** Construct a cmake package build target. */
export let target = tg.target(async (...args: std.Args<BuildArg>) => {
	let mutationArgs = await std.args.createMutations<
		BuildArg,
		std.args.MakeArrayKeys<BuildArg, "env" | "phases" | "sdk">
	>(std.flatten(args), {
		env: "append",
		generator: "set",
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
		debug = false,
		defaultCFlags = true,
		env: userEnv,
		fullRelro = true,
		generator = "Ninja",
		hardeningCFlags = true,
		host: host_,
		march,
		mtune,
		opt = "2",
		parallel = true,
		phases,
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

	// Add cmake to env.
	env = await std.env.arg(await cmake({ host }), env);

	// If the generator is ninja, add ninja to env.
	if (generator === "Ninja") {
		env = await std.env.arg(await ninja({ host }), env);
	}

	if (includeSdk) {
		let sdk = await std.sdk(sdkArgs);
		env = await std.env.arg(sdk, env);
	}

	// Include any user-defined env with higher precedence than the SDK and autotools settings.
	env = await std.env.arg(env, userEnv);

	// Define default phases.
	let configureArgs = [
		`-S`,
		tg.template(source),
		`-G`,
		`"${generator}"`,
		tg`-DCMAKE_INSTALL_PREFIX=${prefixPath}`,
	];
	let defaultConfigure = {
		command: `cmake`,
		args: configureArgs,
	};

	let jobs = parallel ? (os === "darwin" ? "8" : "$(nproc)") : "1";
	let jobsArg = tg.Mutation.prefix(`-j${jobs}`, " ");
	let defaultBuild = {
		command: `cmake`,
		args: [`--build`, `.`, jobsArg],
	};

	let defaultInstall = {
		command: `cmake`,
		args: [`--build`, `.`, `--target`, `install`],
	};

	let defaultPhases: tg.Unresolved<std.phases.PhasesArg> = {
		configure: defaultConfigure,
		build: defaultBuild,
		install: defaultInstall,
	};

	if (debug) {
		let defaultFixup = {
			command: `mkdir -p $LOGDIR && cp config.log $LOGDIR/config.log`,
		};
		defaultPhases.fixup = defaultFixup;
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

/** Build a cmake package. */
export let build = tg.target(
	async (...args: std.Args<BuildArg>): Promise<tg.Directory> => {
		return tg.Directory.expect(await (await target(...args)).output());
	},
);

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

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: cmake,
		binaries: ["cmake"],
		metadata,
		sdk: {},
	});
	return true;
});
