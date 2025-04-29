import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.ts";
import ninja from "./ninja.tg.ts";

export const metadata = {
	homepage: "https://cmake.org/",
	license: "BSD-3-Clause",
	name: "cmake",
	repository: "https://gitlab.kitware.com/cmake/cmake",
	version: "3.31.7",
};

export const source = tg.command(() => {
	const { version } = metadata;
	const checksum =
		"sha256:821bdff48a3f683bc4bb3b6f0b5fe7b2d647cf65d52aeb63328c91a6c6df285a";
	const owner = "Kitware";
	const repo = "CMake";
	const tag = `v${version}`;
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
export const cmake = tg.command(async (arg?: Arg) => {
	const {
		build: build_,
		env: env_,
		host: host_,
		sdk,
		source: source_,
	} = arg ?? {};
	const host = host_ ?? (await std.triple.host());
	const build = build_ ?? host;

	const sourceDir = source_ ?? source();

	const configure = {
		command: `./bootstrap`,
		args: [
			`--parallel=$(nproc)`,
			`--`,
			`-DCMAKE_USE_OPENSSL=OFF`,
			`-DBUILD_SHARED_LIBS=OFF`,
		],
	};

	const bootstrapSdk = await std.sdk(bootstrap.sdk.arg(host));
	const env = std.env.arg(
		bootstrapSdk,
		bootstrap.make.build({ host }),
		{
			CC: "cc -static",
			CXX: "c++ -static",
			TANGRAM_LINKER_PASSTHROUGH: true,
		},
		env_,
	);

	const result = std.autotools.build({
		...(await std.triple.rotate({ build, host })),
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
	/** Path to use for the build directory. Default: "build". */
	buildDir?: string;

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

	/** The value to pass to `-mtune` in the default CFLAGS. Default: "generic". */
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
export const build = tg.command(async (...args: std.Args<BuildArg>) => {
	const mutationArgs = await std.args.createMutations<
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
	const {
		buildDir = "build",
		debug = false,
		defaultCFlags = true,
		env: userEnv,
		fullRelro = true,
		generator = "Ninja",
		hardeningCFlags = true,
		host: host_,
		march,
		mtune = "generic",
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
	let cflags = tg``;
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

	// Add cmake to env.
	env = await std.env.arg(await cmake({ host }), env);

	// If the generator is ninja, add ninja to env.
	if (generator === "Ninja") {
		env = await std.env.arg(await ninja({ host }), env);
	}

	if (includeSdk) {
		const sdk = await std.sdk(sdkArgs);
		const utils = await std.utils.env({
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
	const configureArgs = [
		`-S`,
		tg.template(source),
		`-G`,
		`"${generator}"`,
		tg`-DCMAKE_INSTALL_PREFIX=${prefixPath}`,
		`-B`,
		buildDir,
	];
	const defaultConfigure = {
		command: `cmake`,
		args: configureArgs,
	};

	const jobs = parallel ? (os === "darwin" ? "8" : "$(nproc)") : "1";
	const jobsArg = tg.Mutation.prefix(`-j${jobs}`, " ");
	const defaultBuild = {
		command: `cmake`,
		args: [`--build`, buildDir, jobsArg],
	};

	const defaultInstall = {
		command: `cmake`,
		args: [`--build`, buildDir, `--target`, `install`],
	};

	const defaultPhases: tg.Unresolved<std.phases.PhasesArg> = {
		configure: defaultConfigure,
		build: defaultBuild,
		install: defaultInstall,
	};

	if (debug) {
		const defaultFixup = {
			command: `mkdir -p $LOGDIR && cp config.log $LOGDIR/config.log`,
		};
		defaultPhases.fixup = defaultFixup;
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

export const test = tg.command(async () => {
	// FIXME
	// await std.assert.pkg({ buildFn: cmake, binaries: ["cmake"], metadata });
	return true;
});
