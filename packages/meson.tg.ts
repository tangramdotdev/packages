import * as ninja from "ninja" with { source: "./ninja.tg.ts" };
import * as python from "python" with { source: "./python" };
import * as std from "std" with { source: "./std" };

export const metadata = {
	homepage: "https://mesonbuild.com",
	license: "Apache-2.0",
	name: "meson",
	repository: "https://github.com/mesonbuild/meson",
	version: "1.12.1",
	tag: "meson/1.12.1",
	provides: {
		binaries: ["meson"],
	},
};

export function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:ab0a6ca09f8ef70c564c8241fb5a23957886a0b53fb58412b5e07eaf07dba743";
	return std.download.fromGithub({
		checksum,
		owner: "mesonbuild",
		repo: name,
		source: "release",
		tag: version,
		version,
	});
}

export type Arg = std.args.BasePackageArg;

/** Build `meson`. */
export async function self(...args: tg.Args<Arg>) {
	const {
		build,
		host,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);
	const sourceDir = source_ ?? (await source());
	const pythonArtifact = await python.self({ build, host });

	// Run meson.py from the source directory through python's package path, so that meson records `python meson.py` as the command that build backends invoke.
	const meson = await std.wrap(
		tg`exec ${pythonArtifact}/bin/python3 ${sourceDir}/meson.py "$@"`,
		{ build, host },
	);
	return tg.directory({ "bin/meson": meson });
}

export default self;

export type BuildArg = {
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

	/** Should the flags include FORTIFY_SOURCE? `false` will disable, `true` will default to 3, values less than 0 or greater than 3 will throw an error. Default: 2. */
	fortifySource?: boolean | number | null;

	/** Use full RELRO? Will use partial if disabled. May cause long start-up times in large programs. Default: true. */
	fullRelro?: boolean;

	/** Should we add the extra set of hardening CFLAGS? Default: true */
	hardeningCFlags?: boolean;

	/** The computer this build should get compiled on. */
	host?: string | null;

	/** The value to pass to `-march` in the default CFLAGS. Default: undefined. */
	march?: string | null;

	/** The value to pass to `-mtune` in the default CFLAGS. Default: "generic". */
	mtune?: string | null;

	/** Should this build have network access? Must set a checksum to enable. Default: false. */
	network?: boolean;

	/** The optlevel to pass. Defaults to "2" */
	opt?: "1" | "2" | "3" | "s" | "z" | "fast" | null;

	/** Override the default phase order. Default: ["configure", "build", "install"]. */
	order?: Array<string> | null;

	/** Should ninja jobs run in parallel? Default: true. */
	parallel?: boolean;

	/** Override the phases. */
	phases?: std.phases.Arg | std.phases.Arg[] | null;

	/** Compile with `-pipe`? This option allows the compiler to use pipes instead of temporary files internally, speeding up compilation at the cost of increased memory. Disable if compiling in low-memory environments. This has no effect on the output. Default: true. */
	pipe?: boolean;

	/** Should the build environment include pkg-config? Default: true */
	pkgConfig?: boolean;

	/** The filepath to use as the installation prefix. Usually the default is what you want here. */
	prefixPath?: tg.Template.Arg | null;

	/** A name for the build process. */
	processName?: string | null;

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
};

/** The result of arg(), a BuildArg with the build, host, and source resolved and the dependencies built into the environment. */
export type ResolvedArg = Omit<
	BuildArg,
	"build" | "deps" | "host" | "phases" | "source"
> & {
	build: string;
	host: string;
	phases: std.phases.Arg;
	source: tg.Directory | tg.Template;
};

/** Resolve meson args, building the dependencies into the environment. */
export async function arg(...args: tg.Args<BuildArg>): Promise<ResolvedArg> {
	type MergedArg = Omit<BuildArg, "phases"> & {
		phases: Array<std.phases.Arg>;
	};
	const merged = await tg.Args.apply<BuildArg, MergedArg, MergedArg>({
		args,
		map: async (arg) => {
			const phases = Array.isArray(arg.phases)
				? arg.phases
				: arg.phases !== undefined && arg.phases !== null
					? [arg.phases]
					: [];
			return { ...arg, phases } as MergedArg;
		},
		reduce: {
			env: (a, b) => std.env.arg(a ?? null, b ?? null),
			phases: "append",
			sdk: (a, b) => std.sdk.mergeArg(a, b),
			subtreeEnv: (a, b) => std.env.arg(a ?? null, b ?? null),
			subtreeSdk: (a, b) => std.sdk.mergeArg(a, b),
		},
	});
	const {
		build: build_,
		deps,
		env: userEnv,
		host: host_,
		phases: userPhases,
		source: source_,
		...rest
	} = merged;
	tg.assert(
		source_ !== undefined && source_ !== null,
		"source must be defined",
	);
	const source = await tg.resolve(source_);
	const host = host_ ?? std.triple.host();
	const build = build_ ?? host;

	// Build the dependencies, with the user environment taking precedence.
	const depsConfig = await std.deps.resolveConfig(deps);
	const depsEnv = depsConfig
		? await std.deps.env(depsConfig, {
				build,
				host,
				...std.args.optional("sdk", rest.sdk),
				...std.args.optional("env", userEnv),
				...std.args.optional("subtreeEnv", rest.subtreeEnv),
				...std.args.optional("subtreeSdk", rest.subtreeSdk),
			})
		: undefined;
	const env = await std.env.arg(depsEnv ?? null, userEnv ?? null);
	const phases = await std.phases.arg(...userPhases);

	return { ...rest, build, env, host, phases, source };
}

/** Construct a meson package build target. */
export async function build(...args: tg.Args<BuildArg>) {
	const {
		build,
		buildDir = "build",
		checksum,
		debug = false,
		env: userEnv,
		extended = true,
		fortifySource = 2,
		fullRelro = true,
		hardeningCFlags = true,
		host,
		march,
		mtune = "generic",
		network = false,
		opt = "2",
		order,
		parallel = true,
		phases: userPhases,
		pipe = true,
		pkgConfig = true,
		prefixPath = tg`${tg.output}`,
		processName,
		sdk,
		source,
		stripExecutables = true,
		subtreeSdk,
	} = await arg(...args);

	// For the top-level package, the subtree SDK applies to this build as well, and the build's own argument takes precedence.
	const effectiveSdk = await std.sdk.mergeArg(subtreeSdk, sdk);

	// Add the compiler environment, and meson and ninja for the build machine, with the user environment taking precedence.
	const ccEnv = await std.cc.env({
		build,
		extended,
		fortifySource: fortifySource ?? 2,
		fullRelro,
		hardeningCFlags,
		host,
		...std.args.optional("march", march),
		mtune: mtune ?? "generic",
		opt: opt ?? "2",
		pipe,
		pkgConfig,
		...(effectiveSdk !== undefined ? { sdk: effectiveSdk } : {}),
		stripExecutables,
	});
	const mesonArtifact = await tg.build(self, { build, host: build });
	const ninjaArtifact = await tg.build(ninja.build, { build, host: build });
	const env = await std.env.arg(
		ccEnv,
		mesonArtifact,
		ninjaArtifact,
		userEnv ?? null,
	);

	// Configure with the plain build type, so that the compiler environment's flags apply unchanged, forbid subproject downloads, and describe the host machine when cross-compiling.
	const crossArgs = build !== host ? [tg`--cross-file=${crossFile(host)}`] : [];
	const configure = {
		command: "meson",
		args: [
			"setup",
			buildDir,
			tg.template(source),
			tg`--prefix=${prefixPath}`,
			"--libdir=lib",
			"--buildtype=plain",
			"--wrap-mode=nodownload",
			...crossArgs,
		],
	};
	const jobs = parallel ? "$(nproc)" : "1";
	const defaultPhases = {
		configure,
		build: {
			command: "meson",
			args: ["compile", "-C", buildDir, `-j${jobs}`],
		},
		install: {
			command: "meson",
			args: ["install", "-C", buildDir],
		},
		fixup: {
			command: await std.pkgconfig.shellNormalizeCommand(),
		},
	};
	const phases = await std.phases.arg(defaultPhases, userPhases);

	// The build runs on the `build` machine.
	return await std.phases
		.run({
			bootstrap: true,
			checksum: checksum ?? null,
			debug,
			env,
			host: std.triple.archAndOs(build),
			network,
			phases,
			...(order !== undefined && order !== null ? { order } : {}),
			...(processName !== undefined && processName !== null
				? { processName }
				: {}),
		})
		.then(tg.Directory.expect);
}

export async function test() {
	const spec = std.assert.defaultSpec(metadata);
	await std.assert.pkg(self, spec);
	await testBuild();
	return true;
}

/** Check that the build helper compiles, installs, and runs a C program that links a shared library, which makes the backend invoke meson internally. */
export async function testBuild() {
	const source = tg.directory({
		"meson.build": `project('hello', 'c')\ngreet = shared_library('greet', 'greet.c', install: true)\nexecutable('hello', 'main.c', link_with: greet, install: true)\n`,
		"greet.c": `#include <stdio.h>\nvoid greet(void) { puts("hello from meson"); }\n`,
		"main.c": `void greet(void);\nint main(void) { greet(); return 0; }\n`,
	});
	const output = await build({ source });
	const hello = await output.get("bin/hello").then(tg.File.expect);
	const stdout = await std.build`${hello} > ${tg.output}`
		.then(tg.File.expect)
		.then((file) => file.text);
	tg.assert(stdout.trim() === "hello from meson");
	return true;
}

/** Create a meson cross file that names the host's toolchain and machine. */
function crossFile(host: string) {
	const prefix = `${std.sdk.canonicalTriple(host)}-`;
	const cpu = std.triple.arch(host);
	const system = std.triple.os(host);
	return tg.file(
		`[binaries]\nc = '${prefix}cc'\ncpp = '${prefix}c++'\nar = '${prefix}ar'\nstrip = '${prefix}strip'\npkg-config = 'pkg-config'\n\n[host_machine]\nsystem = '${system}'\ncpu_family = '${cpu}'\ncpu = '${cpu}'\nendian = 'little'\n`,
	);
}
