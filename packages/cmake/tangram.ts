import * as std from "std" with { source: "../std" };
import * as curl from "curl" with { source: "../curl.tg.ts" };
import * as libiconv from "libiconv" with { source: "../libiconv.tg.ts" };
import * as libpsl from "libpsl" with { source: "../libpsl.tg.ts" };
import * as make from "gnumake" with { source: "../gnumake.tg.ts" };
import * as ncurses from "ncurses" with { source: "../ncurses.tg.ts" };
import * as openssl from "openssl" with { source: "../openssl.tg.ts" };
import * as zlib from "zlib" with { source: "../zlib.tg.ts" };
import * as zstd from "zstd" with { source: "../zstd.tg.ts" };

import patches from "./patches" with { type: "directory" };

import * as ninja from "./ninja.tg.ts";
export * as ninja from "./ninja.tg.ts";

export const metadata = {
	homepage: "https://cmake.org/",
	license: "BSD-3-Clause",
	name: "cmake",
	repository: "https://gitlab.kitware.com/cmake/cmake",
	version: "4.4.0",
	tag: "cmake/4.4.0",
	provides: {
		binaries: ["cmake"],
	},
};

export async function source() {
	const { version } = metadata;
	const checksum =
		"sha256:65757f442fdd242e27f1728fc26dc0cba4164f7a0791a5c788631c00080369bc";
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
}

export function deps() {
	return std.deps({
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
}

export type Arg = std.autotools.Arg & std.deps.Arg<typeof deps>;

/** Build `cmake`. */
export async function self(...args: tg.Args<Arg>) {
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
		...(arg.sdk !== undefined && arg.sdk !== null ? { sdk: arg.sdk } : {}),
		subtreeEnv: arg.subtreeEnv ?? null,
		...(arg.subtreeSdk !== undefined && arg.subtreeSdk !== null
			? { subtreeSdk: arg.subtreeSdk }
			: {}),
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

	const env = await std.env.arg(...artifactList, arg.env ?? null);

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
}

export default self;

export type BuildArg = {
	/** Bootstrap mode will disable adding any implicit package builds like the SDK and standard utils. All dependencies must be explicitly provided via `env`. Default: false. */
	bootstrap?: boolean;

	/** The machine performing the compilation. */
	build?: string | null;

	/** Path to use for the build directory. Default: "build". */
	buildDir?: string;

	/** If the build requires network access, provide a checksum or the string "any" to accept any result. */
	checksum?: tg.Checksum | null;

	/** Debug mode will enable additional log output, allow failures in subprocesses, and include a folder of logs at ${tg.output}/.tangram_logs. Default: false */
	debug?: boolean;

	/** Dependencies configuration. */
	deps?: std.deps.ConfigArg | null;

	/** Any environment to add to the target. */
	env?: std.env.Arg | null;

	/** Should the build environment include `m4`, `bison`, `perl`, and `gettext`? Default: true. */
	extended?: boolean;

	/** Should the flags include FORTIFY_SOURCE? `false` will disable, `true` will default to 3, values less than 0 or greater than 3 will throw an error. Default: 3. */
	fortifySource?: boolean | number | null;

	/** Use full RELRO? Will use partial if disabled. May cause long start-up times in large programs. Default: true. */
	fullRelro?: boolean;

	/** Which generator to use. Default: "Ninja" */
	generator?: "Ninja" | "Unix Makefiles";

	/** Should we add the extra set of hardening CFLAGS? Default: true */
	hardeningCFlags?: boolean;

	/** The computer this build should get compiled on. */
	host?: string | null;

	/** The value to pass to `-march` in the default CFLAGS. Default: undefined. */
	march?: string | null;

	/** The value to pass to `-mtune` in the default CFLAGS. Default: "generic". */
	mtune?: string | null;

	/** A name for the build process. */
	processName?: string | null;

	/** Should this build have network access? Must set a checksum to enable. Default: false. */
	network?: boolean;

	/** The optlevel to pass. Defaults to "2" */
	opt?: "1" | "2" | "3" | "s" | "z" | "fast" | null;

	/** Override the default phase order. Default: ["configure", "build", "install"]. */
	order?: Array<string> | null;

	/** Should make jobs run in parallel? Default: false until new branch. */
	parallel?: boolean | number | null;

	/** Override the phases. */
	phases?: std.phases.Arg | std.phases.Arg[] | null;

	/** Compile with `-pipe`? This option allows the compiler to use pipes instead of temporary files internally, speeding up compilation at the cost of increased memory. Disable if compiling in low-memory environments. This has no effect on the output. Default: true. */
	pipe?: boolean;

	/** Should the build environment include pkg-config? Default: true */
	pkgConfig?: boolean;

	/** The filepath to use as the installation prefix. Usually the default is what you want here. */
	prefixPath?: tg.Template.Arg | null;

	/** Arguments to use for the SDK. */
	sdk?: std.sdk.Arg | null;

	/** The source to build. Can be a Directory or a template path that resolves to a directory. */
	source?: tg.Directory | tg.Template | null;

	/** Environment to propagate to all dependencies in the subtree. */
	subtreeEnv?: std.env.Arg;

	/** SDK configuration to propagate to all dependencies in the subtree. */
	subtreeSdk?: std.sdk.Arg | null;

	/** Should executables be stripped? Default is true. */
	stripExecutables?: boolean;

	/** The computer this build produces executables for. */
	target?: string | null;
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
export async function arg(...args: tg.Args<BuildArg>): Promise<ResolvedArg> {
	type Collect = Omit<std.args.MakeArrayKeys<BuildArg, "phases">, "phases"> & {
		phases: Array<std.phases.Arg>;
	};
	const collect = await std.args.apply<BuildArg, Collect>({
		args,
		map: async (arg) => {
			const phases = Array.isArray(arg.phases)
				? arg.phases
				: arg.phases !== undefined && arg.phases !== null
					? [arg.phases]
					: [];
			return {
				...arg,
				phases,
			} as Collect;
		},
		reduce: {
			env: (a, b) => std.env.arg(a ?? null, b ?? null),
			phases: "append",
			sdk: (a, b) => std.sdk.arg(a ?? null, b ?? null),
			subtreeEnv: (a, b) => std.env.arg(a ?? null, b ?? null),
			subtreeSdk: (a, b) => std.sdk.arg(a ?? null, b ?? null),
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

	tg.assert(
		source_ !== undefined && source_ !== null,
		"source must be defined",
	);
	const source = await tg.resolve(source_);

	// Determine build and host triples.
	const host = host_ ?? std.triple.host();
	const build = build_ ?? host;

	// Build dependencies and create env.
	const depsConfig = await std.deps.resolveConfig(deps);
	const depsEnv = depsConfig
		? await std.deps.env(depsConfig, {
				build,
				host,
				...(rest.sdk !== undefined && rest.sdk !== null
					? { sdk: rest.sdk }
					: {}),
				env: userEnv ?? null,
				subtreeEnv: rest.subtreeEnv ?? null,
				...(rest.subtreeSdk !== undefined && rest.subtreeSdk !== null
					? { subtreeSdk: rest.subtreeSdk }
					: {}),
			})
		: undefined;

	// Merge phases.
	const mergedPhases = await std.phases.arg(...userPhaseArgs);

	// Merge env: deps env → user env.
	const env = await std.env.arg(depsEnv ?? null, userEnv ?? null);

	return {
		build,
		host,
		source,
		env,
		phases: mergedPhases,
		...rest,
	};
}

/** Construct a cmake package build target. */
export async function build(...args: tg.Args<BuildArg>) {
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
		processName,
		network = false,
		opt = "2",
		order,
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

	// Add C/C++ compiler environment (flags, SDK, build tools).
	const ccEnv = await std.cc.env({
		host,
		build: build_,
		bootstrap,
		extended,
		fortifySource: fortifySource_ ?? 2,
		fullRelro,
		hardeningCFlags,
		...(march !== undefined && march !== null ? { march } : {}),
		mtune: mtune ?? "generic",
		opt: opt ?? "2",
		pipe,
		pkgConfig,
		...(sdkArg !== undefined && sdkArg !== null ? { sdk: sdkArg } : {}),
		stripExecutables,
	});
	envs.push(ccEnv);

	// Add cmake to env.
	const cmakeArtifact = await tg.build(self, { host });
	envs.push(cmakeArtifact);

	// If the generator is ninja, add ninja to env.
	if (generator === "Ninja") {
		envs.push(await tg.build(ninja.build, { host }));
	} else if (generator === "Unix Makefiles") {
		envs.push(await tg.build(make.build, { host }));
	}

	// Include any user-defined env with higher precedence than the SDK and cmake settings.
	const env = await std.env.arg(...envs, userEnv ?? null);

	// Define default phases.
	const configureArgs = [
		`-S`,
		tg.template(source),
		`-G`,
		`"${generator}"`,
		tg`-DCMAKE_INSTALL_PREFIX=${prefixPath}`,
		`-DCMAKE_INSTALL_LIBDIR=lib`,
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

	const defaultPhases = {
		configure: defaultConfigure,
		build: defaultBuild,
		install: defaultInstall,
		...(debug
			? {
					fixup: {
						command: `mkdir -p $LOGDIR && cp config.log $LOGDIR/config.log`,
					},
				}
			: {}),
	};

	// Normalize user phases to array for merging.
	const userPhasesArray = Array.isArray(userPhaseArgs)
		? userPhaseArgs
		: userPhaseArgs !== undefined
			? [userPhaseArgs]
			: [];

	// Merge default phases with user phases.
	const mergedPhases = await std.phases.arg(defaultPhases, ...userPhasesArray);

	const system = std.triple.archAndOs(host);
	let output = await tg
		.build(std.phases.run, {
			bootstrap: true,
			debug,
			phases: mergedPhases,
			env,
			command: { host: system },
			checksum: checksum ?? null,
			network,
			...(order !== undefined ? { order } : {}),
			...(processName !== undefined ? { processName } : {}),
		})
		.then(tg.Directory.expect);

	// cmake's file(INSTALL) strips xattrs. Re-wrap compiled binaries to
	// restore tgld dependency metadata.
	try {
		const binDir = await output.get("bin").then(tg.Directory.expect);
		for await (const [name, artifact] of binDir) {
			if (artifact instanceof tg.File) {
				const meta = await std.file.tryExecutableMetadata(artifact);
				if (meta?.format === "elf" || meta?.format === "mach-o") {
					output = await tg.directory(output, {
						[`bin/${name}`]: std.wrap(artifact),
					});
				}
			}
		}
	} catch {
		// No bin directory (library-only packages) - nothing to re-wrap.
	}

	return output;
}

export async function test() {
	const spec = std.assert.defaultSpec(metadata);
	await std.assert.pkg(self, spec);

	await ninja.test();

	return true;
}
