import * as std from "std" with { path: "../std" };
import * as curl from "curl" with { path: "../curl" };
import * as libpsl from "libpsl" with { path: "../libpsl" };
import * as make from "gnumake" with { path: "../gnumake" };
import * as ncurses from "ncurses" with { path: "../ncurses" };
import * as openssl from "openssl" with { path: "../openssl" };
import * as zlib from "zlib" with { path: "../zlib" };
import * as zstd from "zstd" with { path: "../zstd" };

import patches from "./patches" with { type: "directory" };

import * as ninja from "./ninja.tg.ts";
export * as ninja from "./ninja.tg.ts";

export const metadata = {
	homepage: "https://cmake.org/",
	license: "BSD-3-Clause",
	name: "cmake",
	repository: "https://gitlab.kitware.com/cmake/cmake",
	version: "3.31.4",
	provides: {
		binaries: ["cmake"],
	},
};

export const source = tg.target(() => {
	const { version } = metadata;
	const checksum =
		"sha256:a6130bfe75f5ba5c73e672e34359f7c0a1931521957e8393a5c2922c8b0f7f25";
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
});

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		curl?: curl.Arg;
		libpsl?: libpsl.Arg;
		ncurses?: ncurses.Arg;
		openssl?: openssl.Arg;
		zlib?: zlib.Arg;
		zstd?: zstd.Arg;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

/** Build `cmake`. */
export const self = tg.target(async (...args: std.Args<Arg>) => {
	const {
		build,
		dependencies: {
			curl: curlArg = {},
			libpsl: libpslArg = {},
			ncurses: ncursesArg = {},
			openssl: opensslArg = {},
			zlib: zlibArg = {},
			zstd: zstdArg = {},
		} = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);
	const sourceDir = source_ ?? source();
	const os = std.triple.os(host);

	const curlRoot = curl.build({ build, env: env_, host, sdk }, curlArg);
	const ncursesRoot = ncurses.build(
		{ build, env: env_, host, sdk },
		ncursesArg,
	);
	const libpslRoot = libpsl.build({ build, env: env_, host, sdk }, libpslArg);
	const opensslRoot = openssl.build(
		{ build, env: env_, host, sdk },
		opensslArg,
	);
	const zlibRoot = zlib.build({ build, env: env_, host, sdk }, zlibArg);
	const zstdRoot = zstd.build({ build, env: env_, host, sdk }, zstdArg);

	let configureArgs = ["--parallel=$(nproc)", "--system-curl", "--"];
	if (os === "linux") {
		configureArgs = configureArgs.concat([
			`-DCMAKE_LIBRARY_PATH="$(echo $LIBRARY_PATH | tr ':' ';')"`,
			`-DCMAKE_INCLUDE_PATH="$(echo $CPATH | tr ':' ';')"`,
		]);
	}
	const configure = {
		command: tg`${sourceDir}/bootstrap`,
		args: configureArgs,
	};
	const phases = { configure };

	const deps = [
		curlRoot,
		ncursesRoot,
		libpslRoot,
		opensslRoot,
		zlibRoot,
		zstdRoot,
	];
	const env = [...deps, env_];
	if (os === "darwin") {
		// On macOS, the bootstrap script wants to test for `ext/stdio_filebuf.h`, which is not part of the macOS toolchain.
		// Using the `gcc` and `g++` named symlinks to the AppleClang compiler instead of `clang`/`clang++` prevents this.
		env.push({
			CC: "gcc",
			CXX: "g++",
		});
	}

	let result = await std.autotools.build({
		...(await std.triple.rotate({ build, host })),
		env: std.env.arg(...env),
		phases,
		setRuntimeLibraryPath: os === "linux",
		sdk,
		source: sourceDir,
	});

	if (os === "linux") {
		const libraryPaths = deps.map((dir) =>
			dir.then((dir: tg.Directory) => dir.get("lib").then(tg.Directory.expect)),
		);
		const binDir = await result.get("bin").then(tg.Directory.expect);
		for await (let [name, artifact] of binDir) {
			const file = tg.File.expect(artifact);
			const wrappedFile = await std.wrap(file, { libraryPaths });
			result = await tg.directory(result, { [`bin/${name}`]: wrappedFile });
		}
	}

	return result;
});

export default self;

export type BuildArg = {
	/** If the build requires network access, provide a checksum or the string "unsafe" to accept any result. */
	checksum?: tg.Checksum;

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
	sdk?: boolean | tg.MaybeNestedArray<std.sdk.Arg>;

	/** The source to build, which must be an autotools binary distribution bundle. This means there must be a configure script in the root of the source code. If necessary, autoreconf must be run before calling this function. */
	source?: tg.Template.Arg;

	/** Should executables be stripped? Default is true. */
	stripExecutables?: boolean;

	/** The computer this build produces executables for. */
	target?: string;
};

/** Construct a cmake package build target. */
export const target = tg.target(async (...args: std.Args<BuildArg>) => {
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
	env = await std.env.arg(await self({ host }), env);

	// If the generator is ninja, add ninja to env.
	if (generator === "Ninja") {
		env = await std.env.arg(await ninja.build({ host }), env);
	} else if (generator === "Unix Makefiles") {
		env = await std.env.arg(await make.build({ host }), env);
	}

	if (includeSdk) {
		const sdk = await std.sdk(sdkArgs);
		env = await std.env.arg(sdk, env);
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
	];
	const defaultConfigure = {
		command: `cmake`,
		args: configureArgs,
	};

	const jobs = parallel ? (os === "darwin" ? "8" : "$(nproc)") : "1";
	const jobsArg = tg.Mutation.prefix(`-j${jobs}`, " ");
	const defaultBuild = {
		command: `cmake`,
		args: [`--build`, `.`, jobsArg],
	};

	const defaultInstall = {
		command: `cmake`,
		args: [`--build`, `.`, `--target`, `install`],
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
export const build = tg.target(
	async (...args: std.Args<BuildArg>): Promise<tg.Directory> => {
		return tg.Directory.expect(await (await target(...args)).output());
	},
);

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
export const test = tg.target(async () => {
	const spec = std.assert.defaultSpec(metadata);
	await std.assert.pkg(self, spec);

	await ninja.test();

	return true;
});
