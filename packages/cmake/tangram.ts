import * as std from "std" with { local: "../std" };
import * as curl from "curl" with { local: "../curl.tg.ts" };
import * as libiconv from "libiconv" with { local: "../libiconv.tg.ts" };
import * as libpsl from "libpsl" with { local: "../libpsl.tg.ts" };
import * as make from "gnumake" with { local: "../gnumake.tg.ts" };
import * as ncurses from "ncurses" with { local: "../ncurses.tg.ts" };
import * as openssl from "openssl" with { local: "../openssl.tg.ts" };
import * as zlib from "zlib" with { local: "../zlib.tg.ts" };
import * as zstd from "zstd" with { local: "../zstd.tg.ts" };

import patches from "./patches" with { type: "directory" };

import * as ninja from "./ninja.tg.ts";
export * as ninja from "./ninja.tg.ts";

export const metadata = {
	homepage: "https://cmake.org/",
	license: "BSD-3-Clause",
	name: "cmake",
	repository: "https://gitlab.kitware.com/cmake/cmake",
	version: "3.31.8",
	tag: "cmake/3.31.8",
	provides: {
		binaries: ["cmake"],
	},
};

export const source = async () => {
	const { version } = metadata;
	const checksum =
		"sha256:e3cde3ca83dc2d3212105326b8f1b565116be808394384007e7ef1c253af6caa";
	const owner = "Kitware";
	const repo = "CMake";
	const tag = `v${version}`;
	return std.download
		.fromGithub({
			checksum,
			owner,
			repo,
			source: "release",
			tag,
			version,
		})
		.then((source) => std.patch(source, patches));
};

const deps = await std.deps({
	curl: curl.build,
	libiconv: {
		build: libiconv.build,
		kind: "runtime",
		when: (ctx) => std.triple.os(ctx.host) === "darwin",
	},
	libpsl: libpsl.build,
	ncurses: ncurses.build,
	openssl: openssl.build,
	zlib: zlib.build,
	zstd: zstd.build,
});

export type Arg = std.autotools.Arg & std.deps.Arg<typeof deps>;

/** Build `cmake`. */
export const self = async (...args: std.Args<Arg>) => {
	const arg = await std.autotools.arg(
		{ source: source(), deps, setRuntimeLibraryPath: true },
		...args,
	);
	const { build: build_, host, source: sourceDir } = arg;
	const os = std.triple.os(host);

	// Get individual artifacts for env and libraryPaths wrapping.
	const artifacts = await std.deps.artifacts(deps, {
		build: build_,
		host,
		sdk: arg.sdk,
	});
	const artifactList = Object.values(artifacts).filter(
		(v): v is tg.Directory => v !== undefined,
	);

	const configureArgs = [
		"--parallel=$(nproc)",
		"--system-curl",
		"--",
		`-DCMAKE_LIBRARY_PATH="$(echo $LIBRARY_PATH | tr ':' ';')"`,
		`-DCMAKE_INCLUDE_PATH="$(echo $CPATH | tr ':' ';')"`,
	];
	const prepare = {
		command: tg.Mutation.prefix("mkdir work && cd work", "\n"),
	};
	const configure = {
		command: tg`${sourceDir}/bootstrap`,
		args: configureArgs,
	};

	const env = await std.env.arg(...artifactList, arg.env);

	let result = await std.autotools.build({
		...arg,
		env,
		phases: { prepare, configure },
	});

	if (os === "linux") {
		const libraryPaths = artifactList.map((dir) =>
			dir.get("lib").then(tg.Directory.expect),
		);
		const binDir = await result.get("bin").then(tg.Directory.expect);
		for await (const [name, artifact] of binDir) {
			const file = tg.File.expect(artifact);
			const wrappedFile = await std.wrap(file, { libraryPaths });
			result = await tg.directory(result, { [`bin/${name}`]: wrappedFile });
		}
	}

	return result;
};

export default self;

export type BuildArg = {
	/** Bootstrap mode will disable adding any implicit package builds like the SDK and standard utils. All dependencies must be explicitly provided via `env`. Default: false. */
	bootstrap?: boolean | undefined;

	/** The machine performing the compilation. */
	build?: string | undefined;

	/** Path to use for the build directory. Default: "build". */
	buildDir?: string | undefined;

	/** If the build requires network access, provide a checksum or the string "any" to accept any result. */
	checksum?: tg.Checksum | undefined;

	/** Debug mode will enable additional log output, allow failures in subprocesses, and include a folder of logs at ${tg.output}/.tangram_logs. Default: false */
	debug?: boolean | undefined;

	/** Dependencies configuration. */
	deps?: std.deps.Config | undefined;

	/** Any environment to add to the target. */
	env?: std.env.Arg | undefined;

	/** Should the build environment include `m4`, `bison`, `perl`, and `gettext`? Default: true. */
	extended?: boolean | undefined;

	/** Should the flags include FORTIFY_SOURCE? `false` will disable, `true` will default to 3, values less than 0 or greater than 3 will throw an error. Default: 3. */
	fortifySource?: boolean | number | undefined;

	/** Use full RELRO? Will use partial if disabled. May cause long start-up times in large programs. Default: true. */
	fullRelro?: boolean | undefined;

	/** Which generator to use. Default: "Ninja" */
	generator?: "Ninja" | "Unix Makefiles" | undefined;

	/** Should we add the extra set of hardening CFLAGS? Default: true */
	hardeningCFlags?: boolean | undefined;

	/** The computer this build should get compiled on. */
	host?: string | undefined;

	/** The value to pass to `-march` in the default CFLAGS. Default: undefined. */
	march?: string | undefined;

	/** The value to pass to `-mtune` in the default CFLAGS. Default: "generic". */
	mtune?: string | undefined;

	/** Should this build have network access? Must set a checksum to enable. Default: false. */
	network?: boolean | undefined;

	/** The optlevel to pass. Defaults to "2" */
	opt?: "1" | "2" | "3" | "s" | "z" | "fast" | undefined;

	/** Should make jobs run in parallel? Default: false until new branch. */
	parallel?: boolean | number | undefined;

	/** Override the phases. */
	phases?: std.phases.Arg | std.phases.Arg[] | undefined;

	/** Compile with `-pipe`? This option allows the compiler to use pipes instead of temporary files internally, speeding up compilation at the cost of increased memory. Disable if compiling in low-memory environments. This has no effect on the output. Default: true. */
	pipe?: boolean | undefined;

	/** Should the build environment include pkg-config? Default: true */
	pkgConfig?: boolean | undefined;

	/** The filepath to use as the installation prefix. Usually the default is what you want here. */
	prefixPath?: tg.Template.Arg | undefined;

	/** Arguments to use for the SDK. */
	sdk?: std.sdk.Arg | undefined;

	/** The source to build. Can be a Directory or a template path that resolves to a directory. */
	source?: tg.Directory | tg.Template | undefined;

	/** Should executables be stripped? Default is true. */
	stripExecutables?: boolean | undefined;

	/** The computer this build produces executables for. */
	target?: string | undefined;
};

/** The result of arg() - a BuildArg with build, host, and source guaranteed to be resolved. */
export type ResolvedArg = Omit<
	BuildArg,
	"build" | "host" | "source" | "phases"
> & {
	build: string;
	host: string;
	source: tg.Directory | tg.Template;
	/** User phases - either a single Arg or array of Args. Array form preserves mutations until merged with defaults. */
	phases?: std.phases.Arg | Array<std.phases.Arg>;
};

/** Resolve cmake args to a mutable arg object. Returns a BuildArg with build, host, and source guaranteed to be resolved. */
export const arg = async (
	...args: std.Args<BuildArg>
): Promise<ResolvedArg> => {
	type Collect = std.args.MakeArrayKeys<BuildArg, "phases">;
	const collect = await std.args.apply<BuildArg, Collect>({
		args,
		map: async (arg) => {
			return {
				...arg,
				phases: [arg.phases],
			} as Collect;
		},
		reduce: {
			env: (a, b) => std.env.arg(a, b),
			phases: "append",
			sdk: (a, b) => std.sdk.arg(a, b),
		},
	});

	const {
		build: build_,
		deps,
		env: userEnv,
		host: host_,
		phases: userPhaseArgs = [],
		source: source_,
		...rest
	} = collect;

	tg.assert(source_ !== undefined, "source must be defined");
	const source = await tg.resolve(source_);

	// Determine build and host triples.
	const host = host_ ?? std.triple.host();
	const build = build_ ?? host;

	// Build dependencies and create env.
	const depsEnv = deps
		? await std.deps.env(deps, { build, host, sdk: rest.sdk, env: userEnv })
		: undefined;

	// Merge phases.
	const mergedPhases = await std.phases.mergePhases(...userPhaseArgs);

	// Merge env: deps env → user env.
	const env = await std.env.arg(depsEnv, userEnv);

	return {
		build,
		host,
		source,
		env,
		phases: mergedPhases,
		...rest,
	};
};

/** Construct a cmake package build target. */
export const build = async (...args: std.Args<BuildArg>) => {
	const resolved = await arg(...args);
	const {
		build: build_,
		bootstrap = false,
		buildDir = "build",
		checksum,
		debug = false,
		env: userEnv,
		extended = true,
		fortifySource: fortifySource_ = 2,
		fullRelro = true,
		generator = "Ninja",
		hardeningCFlags = true,
		host,
		march,
		mtune = "generic",
		network,
		opt = "2",
		parallel = true,
		phases: userPhaseArgs,
		pkgConfig = true,
		pipe = true,
		prefixPath = tg`${tg.output}`,
		sdk: sdkArg,
		source,
		stripExecutables = true,
		target: target_,
	} = resolved;

	const target = target_ ?? host;
	const os = std.triple.os(host);

	// Set up env.
	let envs: Array<tg.Unresolved<std.env.Arg>> = [];

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
	const cmakeArtifact = await tg.build(self, { host });
	envs.push(cmakeArtifact);

	// If the generator is ninja, add ninja to env.
	if (generator === "Ninja") {
		envs.push(await tg.build(ninja.build, { host }));
	} else if (generator === "Unix Makefiles") {
		envs.push(await tg.build(make.build, { host }));
	}

	if (!bootstrap) {
		// Set up the SDK, add it to the environment.
		const sdk = await tg.build(std.sdk, sdkArg);
		// Add the requested set of utils for the host, compiled with the default SDK to improve cache hits.
		let preset: std.dependencies.Preset | undefined = undefined;
		if (pkgConfig) {
			preset = "minimal";
		}
		if (extended) {
			preset = "autotools";
		}
		if (preset !== undefined) {
			const buildToolsEnv = await tg.build(std.dependencies.buildTools, {
				host,
				buildToolchain: await tg.build(std.sdk, { host }),
				preset,
			});
			envs.push(sdk, buildToolsEnv);
		}
	}

	// Include any user-defined env with higher precedence than the SDK and autotools settings.
	const env = await std.env.arg(...envs, userEnv);

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
	return await tg
		.build(
			std.phases.run,
			{
				bootstrap: true,
				debug,
				phases: defaultPhases,
				env,
				command: { env: { TANGRAM_HOST: system }, host: system },
				checksum,
				network,
			} as std.phases.Arg,
			// biome-ignore lint/suspicious/noExplicitAny: phases type is complex union.
			{ phases: userPhaseArgs } as any,
		)
		.then(tg.Directory.expect);
};

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	await std.assert.pkg(self, spec);

	await ninja.test();

	return true;
};
