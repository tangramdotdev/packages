import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.ts";
import ninja from "./ninja.tg.ts";
import { buildTools } from "./dependencies.tg.ts";

export const metadata = {
	homepage: "https://cmake.org/",
	license: "BSD-3-Clause",
	name: "cmake",
	repository: "https://gitlab.kitware.com/cmake/cmake",
	version: "3.31.7",
};

export const source = () => {
	const { version } = metadata;
	const checksum =
		"sha256:a6d2eb1ebeb99130dfe63ef5a340c3fdb11431cce3d7ca148524c125924cea68";
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
};

export type Arg = {
	build?: string | undefined;
	env?: std.env.Arg;
	host?: string | undefined;
	source?: tg.Directory;
};

/** Build `cmake`. */
export const cmake = async (arg?: tg.Unresolved<Arg>) => {
	const resolved = await tg.resolve(arg);
	const {
		build: build_,
		env: env_,
		host: host_,
		source: source_,
	} = resolved ?? {};
	const host = host_ ?? (await std.triple.host());
	const build = build_ ?? host;

	const sourceDir = source_ ?? source();

	const prepare = { command: tg.Mutation.prefix("mkdir work && cd work") };
	const configure = {
		command: `./bootstrap`,
		args: [
			`--parallel=$(nproc)`,
			`--`,
			`-DCMAKE_USE_OPENSSL=OFF`,
			`-DBUILD_SHARED_LIBS=OFF`,
		],
	};
	const phases = { prepare, configure };

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
		phases,
		sdk: false,
		source: sourceDir,
	});

	return result;
};

export default cmake;

export type BuildArg = {
	/** Path to use for the build directory. Default: "build". */
	buildDir?: string;

	/** Debug mode will enable additional log output, allow failiures in subprocesses, and include a folder of logs at $OUTPUT/.tangram_logs. Default: false */
	debug?: boolean;

	/** Any environment to add to the target. */
	env?: std.env.Arg;

	/** Should the flags include FORTIFY_SORUCE? `false` will disable, `true` will default to 3, values less than 0 or greater than 3 will throw an error. Default: 3.  */
	fortifySource?: boolean | number;

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

	/** Compile with `-pipe`? This option allows the compiler to use pipes instead of tempory files internally, speeding up compilation at the cost of increased memory. Disable if compiling in low-memory environments. This has no effect on the output. Default: true. */
	pipe?: boolean;

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
export const build = async (...args: tg.Args<BuildArg>) => {
	const resolved = await Promise.all(args.map(tg.resolve));
	const objects = resolved.map((obj) => {
		return {
			...obj,
			env: [obj.env],
			phases: [obj.phases],
			sdk: [obj.sdk],
		};
	});
	const {
		buildDir = "build",
		debug = false,
		env: userEnv,
		fortifySource: fortifySource_ = 3,
		fullRelro = true,
		generator = "Ninja",
		hardeningCFlags = true,
		host: host_,
		march,
		mtune = "generic",
		opt = "2",
		parallel = true,
		phases,
		pipe = true,
		prefixPath = `$OUTPUT`,
		sdk: sdkArgs_,
		source,
		stripExecutables = true,
		target: target_,
	} = (await tg.Args.apply(objects, {
		env: "append",
		phases: "append",
		sdk: "append",
		source: "set",
	})) as std.args.MakeArrayKeys<BuildArg, "env" | "phases" | "sdk">;

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
			sdkArgs = [{ host, target }, ...sdkArgs];
		}
	}

	// Set up env.
	let envs: tg.Unresolved<Array<std.env.Arg>> = [];

	// // C/C++ flags.
	if (opt) {
		const optFlag = tg.Mutation.suffix(`-O${opt}`, " ");
		envs.push({ CFLAGS: optFlag, CXXFLAGS: optFlag });
	}
	if (pipe) {
		const pipeFlag = tg.Mutation.suffix("-pipe", " ");
		envs.push({ CFLAGS: pipeFlag, CXXFLAGS: pipeFlag });
	}
	if (march !== undefined) {
		const marchFlag = tg.Mutation.suffix(`-march=${march}`, " ");
		envs.push({ CFLAGS: marchFlag, CXXFLAGS: marchFlag });
	}
	if (mtune !== undefined) {
		const mtuneFlag = tg.Mutation.suffix(`-mtune=${mtune}`, " ");
		envs.push({ CFLAGS: mtuneFlag, CXXFLAGS: mtuneFlag });
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
		const extraFlags = tg.Mutation.suffix(extraCFlags, " ");
		envs.push({ CFLAGS: extraFlags, CXXFLAGS: extraFlags });
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

	// Add cmake to env.
	envs.push(await tg.build(cmake, { host }));

	// If the generator is ninja, add ninja to env.
	if (generator === "Ninja") {
		envs.push(await tg.build(ninja, { host }));
	}

	if (includeSdk) {
		const buildToolsEnv = await tg.build(buildTools, {
			host,
			buildToolchain: std.sdk({ host }),
			level: "pkgconfig",
		});
		envs.push(await tg.build(std.sdk, ...(sdkArgs ?? [])), buildToolsEnv);
	}

	// If cross compiling, override CC/CXX to point to the correct compiler.
	if (host !== target) {
		envs.push({
			CC: `${target}-cc`,
			CXX: `${target}-c++`,
		});
	}

	// Include any user-defined env with higher precedence than the SDK and autotools settings.
	const env = await std.env.arg(...envs, ...(userEnv ?? []));

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
	const jobsArg = `-j${jobs}`;
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
};

export const test = async () => {
	// FIXME
	// await std.assert.pkg({ buildFn: cmake, binaries: ["cmake"], metadata });
	return true;
};
