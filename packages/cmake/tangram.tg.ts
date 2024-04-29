import * as std from "tg:std" with { path: "../std" };
import curl from "tg:curl" with { path: "../curl" };
import pkgconfig from "tg:pkgconfig" with { path: "../pkgconfig" };
import openssl from "tg:openssl" with { path: "../openssl" };
import zlib from "tg:zlib" with { path: "../zlib" };

import ninja, { test as testNinja } from "./ninja.tg.ts";

export let metadata = {
	homepage: "https://cmake.org/",
	license: "BSD-3-Clause",
	name: "cmake",
	repository: "https://gitlab.kitware.com/cmake/cmake",
	version: "3.29.2",
};

export let source = tg.target(() => {
	let { version } = metadata;
	let checksum =
		"sha256:36db4b6926aab741ba6e4b2ea2d99c9193222132308b4dc824d4123cb730352e";
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

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

/** Build `cmake`. */
export let cmake = tg.target(async (arg?: Arg) => {
	let {
		build: build_,
		env: env_,
		host: host_,
		source: source_,
		...rest
	} = arg ?? {};
	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;

	let sourceDir = source_ ?? source();

	let opensslDir = openssl({ ...rest, build, env: env_, host });
	let zlibDir = zlib({ ...rest, build, env: env_, host });

	let configure = {
		command: `./bootstrap`,
		args: [
			`--parallel=$(nproc)`,
			`--system-curl`,
			`--`,
			`-DCMAKE_C_BYTE_ORDER=LITTLE_ENDIAN`,
			`-DCMAKE_CXX_BYTE_ORDER=LITTLE_ENDIAN`,
			`-DCMAKE_EXE_LINKER_FLAGS="-lssl -lcrypto -lz"`,
			tg`-DOPENSSL_ROOT_DIR=${opensslDir}`,
			tg`-DZLIB_ROOT=${zlibDir}`,
		],
	};

	let deps = [
		curl({ ...rest, build, env: env_, host }),
		pkgconfig({ ...rest, build, env: env_, host }),
		opensslDir,
		zlibDir,
	];
	let env = [...deps, env_];

	let result = std.autotools.build({
		...rest,
		...std.triple.rotate({ build, host }),
		buildInTree: true,
		env,
		phases: { configure },
		source: sourceDir,
	});

	return result;
});

export default cmake;

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
	source: tg.Template.Arg;

	/** Should executables be stripped? Default is true. */
	stripExecutables?: boolean;

	/** The computer this build produces executables for. */
	target?: string;
};

/** Construct a cmake package build target. */
export let target = async (...args: tg.Args<BuildArg>) => {
	type Apply = {
		debug: boolean;
		defaultCFlags: boolean;
		fullRelro: boolean;
		generator: "Ninja" | "Unix Makefiles";
		hardeningCFlags: boolean;
		host: string;
		march: string;
		mtune: string;
		opt: "1" | "2" | "3" | "s" | "z" | "fast";
		parallel: boolean | number;
		phases: Array<std.phases.Arg>;
		prefixPath: tg.Template.Arg;
		sdkArgs?: Array<boolean | std.sdk.Arg>;
		source: tg.Template.Arg;
		stripExecutables: boolean;
		target: string;
	};

	let {
		debug = false,
		defaultCFlags = true,
		fullRelro = true,
		generator = "Ninja",
		hardeningCFlags = true,
		host: host_,
		march,
		mtune = "generic",
		opt = 2,
		parallel = true,
		phases,
		prefixPath = "$OUTPUT",
		sdkArgs: sdkArgs_,
		source,
		stripExecutables = true,
		target: target_,
	} = await tg.Args.apply<BuildArg, Apply>(args, async (arg) => {
		if (arg === undefined) {
			return {};
		} else if (typeof arg === "object") {
			let object: tg.MutationMap<Apply> = {};
			let phasesArgs: Array<std.phases.Arg> = [];
			if (arg.checksum !== undefined) {
				phasesArgs.push({ checksum: arg.checksum });
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
			if (arg.env !== undefined) {
				phasesArgs.push({ env: arg.env });
			}
			if (arg.fullRelro !== undefined) {
				object.fullRelro = arg.fullRelro;
			}
			if (arg.generator !== undefined) {
				object.generator = arg.generator;
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

	// Add cmake to env.
	env = [await cmake({ host }), env];

	// If the generator is ninja, add ninja to env.
	if (generator === "Ninja") {
		env = [await ninja({ host }), env];
	}

	if (includeSdk) {
		// Set up the SDK, add it to the environment.
		tg.assert(Array.isArray(sdkArgs));
		if (!sdkArgs.some((arg) => arg?.host)) {
			sdkArgs.push({ host });
		}
		if (host !== target && !sdkArgs.some((arg) => arg?.target)) {
			sdkArgs.push({ target });
		}
		let sdk = await std.sdk(sdkArgs);
		env = [sdk, env];
	}

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
	let jobsArg = tg.Mutation.templatePrepend(`-j${jobs}`, " ");
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

/** Build a cmake package. */
export let build = async (
	...args: tg.Args<BuildArg>
): Promise<tg.Directory> => {
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

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: cmake,
		binaries: ["cmake"],
		metadata,
	});

	await testNinja();

	return true;
});
