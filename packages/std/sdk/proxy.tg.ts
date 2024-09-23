import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.ts";
import { injection } from "../wrap/injection.tg.ts";
import * as workspace from "../wrap/workspace.tg.ts";
import * as gnu from "./gnu.tg.ts";
import * as llvmToolchain from "./llvm.tg.ts";

/** This module is responsible for proxying compiler toolchains. It provides a linker proxy which produces Tangram-wrapped executables and ensure libraries reference all their needed dependencies, and a compiler proxy which schedules Tangram builds for each invocation. */

export type Arg = {
	/** The target triple of the build machine. */
	build?: string;
	/** Should the compiler get proxied? Default: false. */
	compiler?: boolean;
	/** Should we look for a triple-prefixed toolchain, regardless of host? Default: false */
	forcePrefix?: boolean;
	/** Should the linker get proxied? Default: true. */
	linker?: boolean;
	/** Optional linker to use. If omitted, the linker provided by the toolchain matching the requested arguments will be used. */
	linkerExe?: tg.File | tg.Symlink | tg.Template;
	/** The triple of the computer the toolchain being proxied produces binaries for. */
	host?: string;
	/** Should `strip` get proxied? Default: true.  */
	strip?: boolean;
	/** Optional strip command to use. If omitted, will use the strip located with the toolchain. */
	stripExe?: tg.File | tg.Symlink | tg.Template;
	/** The build environment to be proxied. */
	toolchain: std.env.Arg;
};

/** Add a proxy to an env that provides a toolchain. */
export const env = tg.target(async (arg?: Arg): Promise<std.env.Arg> => {
	if (arg === undefined) {
		throw new Error("Cannot proxy an undefined env");
	}

	const proxyCompiler = arg.compiler ?? false;
	const proxyLinker = arg.linker ?? true;
	const proxyStrip = arg.strip ?? true;
	const buildToolchain = arg.toolchain;

	if (!proxyCompiler && !proxyLinker) {
		return;
	}

	if (!proxyLinker && arg.linkerExe !== undefined) {
		throw new Error(
			"Received a linkerExe argument, but linker is not being proxied",
		);
	}

	const dirs = [];

	const host = arg.host ?? (await std.triple.host());
	const build = arg.build ?? host;
	const os = std.triple.os(host);
	const forcePrefix = arg.forcePrefix ?? false;

	const {
		cc: cc_,
		cxx: cxx_,
		fortran,
		directory,
		flavor,
		ld,
		ldso,
		strip,
	} = await std.sdk.toolchainComponents({
		env: buildToolchain,
		forcePrefix,
		host: build,
		target: host,
	});

	let cc: tg.File | tg.Symlink = cc_;
	let cxx: tg.File | tg.Symlink = cxx_;
	const isLlvm = flavor === "llvm";

	if (proxyLinker) {
		const isCross = build !== host;
		const prefix = isCross ? `${host}-` : ``;

		// Construct the ld proxy.
		const ldProxyArtifact = await ldProxy({
			buildToolchain,
			build,
			linker:
				arg.linkerExe === undefined
					? os === "linux" && isLlvm
						? await tg`${directory}/bin/ld.lld`
						: os === "darwin" && isCross
							? await tg`${directory}/bin/${host}-ld.gold`
							: ld
					: arg.linkerExe,
			interpreter: ldso,
			host,
		});

		if (isLlvm) {
			cc = tg.File.expect(await directory.get(`bin/clang`));
			cxx = cc;
		}
		const ldProxyDir = tg.directory({
			ld: ldProxyArtifact,
		});

		// Construct wrappers that always pass the ld proxy.
		let binDir = tg.directory();

		let wrappedCC;
		let wrappedCXX;
		let wrappedGFortran;
		switch (flavor) {
			case "gnu": {
				const { ccArgs, cxxArgs, fortranArgs } = await gnu.gcc.wrapArgs({
					host: build,
					target: host,
					toolchainDir: directory,
				});
				wrappedCC = await std.wrap(cc, {
					args: [tg`-B${ldProxyDir}`, ...(ccArgs ?? [])],
					buildToolchain,
					host: build,
				});
				wrappedCXX = await std.wrap(cxx, {
					args: [tg`-B${ldProxyDir}`, ...(cxxArgs ?? [])],
					buildToolchain,
					host: build,
				});
				if (fortran) {
					wrappedGFortran = await std.wrap(fortran, {
						args: [tg`-B${ldProxyDir}`, ...(fortranArgs ?? [])],
						buildToolchain,
						host: build,
					});
				}

				if (isCross) {
					binDir = tg.directory({
						bin: {
							[`${host}-cc`]: tg.symlink(`${prefix}gcc`),
							[`${host}-c++`]: tg.symlink(`${prefix}g++`),
							[`${host}-gcc`]: wrappedCC,
							[`${host}-g++`]: wrappedCXX,
						},
					});
					if (fortran) {
						binDir = tg.directory(binDir, {
							bin: {
								[`${host}-gfortran`]: wrappedGFortran,
							},
						});
					}
				} else {
					binDir = tg.directory({
						bin: {
							cc: tg.symlink("gcc"),
							[`${host}-cc`]: tg.symlink("gcc"),
							"c++": tg.symlink("g++"),
							[`${host}-c++`]: tg.symlink("g++"),
							gcc: wrappedCC,
							[`${host}-gcc`]: tg.symlink("gcc"),
							"g++": wrappedCXX,
							[`${host}-g++`]: tg.symlink("g++"),
						},
					});
					if (fortran) {
						binDir = tg.directory(binDir, {
							bin: {
								gfortran: wrappedGFortran,
								[`${host}-gfortran`]: tg.symlink("gfortran"),
							},
						});
					}
				}
				break;
			}
			case "llvm": {
				const { clangArgs, clangxxArgs, env } = await llvmToolchain.wrapArgs({
					host: build,
					target: host,
					toolchainDir: directory,
				});
				// On Linux, don't wrap in place.
				const merge = os === "darwin";
				wrappedCC = std.wrap(cc, {
					args: [tg`-B${ldProxyDir}`, ...clangArgs],
					buildToolchain,
					env,
					host: build,
					merge,
				});
				wrappedCXX = std.wrap(cxx, {
					args: [tg`-B${ldProxyDir}`, ...clangxxArgs],
					buildToolchain,
					env,
					host: build,
					merge,
				});
				binDir = tg.directory({
					bin: {
						clang: wrappedCC,
						"clang++": wrappedCXX,
						cc: tg.symlink("clang"),
						"c++": tg.symlink("clang++"),
					},
				});
			}
		}
		dirs.push(binDir);
	}

	if (proxyCompiler) {
		dirs.push(
			ccProxy({
				build,
				buildToolchain,
				host,
			}),
		);
	}

	if (proxyStrip) {
		const stripProxyArtifact = await stripProxy({
			buildToolchain,
			build,
			host,
			stripCommand: arg.stripExe ?? strip,
			runtimeLibraryPath:
				os === "darwin"
					? await directory.get("lib").then(tg.Directory.expect)
					: undefined,
		});
		dirs.push(
			tg.directory({
				"bin/strip": stripProxyArtifact,
			}),
		);
	}

	return std.env.arg(...dirs);
});

export default env;

type CcProxyArg = {
	buildToolchain: std.env.Arg;
	build?: string;
	host?: string;
};

export const ccProxy = async (arg: CcProxyArg) => {
	const host = arg.host ?? (await std.triple.host());
	const build = arg.build ?? host;
	const buildToolchain = arg.buildToolchain;
	const tgcc = workspace.ccProxy({
		buildToolchain,
		build,
		host,
	});

	const isCross = build !== host;
	const prefix = isCross ? `${host}-` : ``;

	return tg.directory({
		[`bin/${prefix}cc`]: tgcc,
		[`bin/${prefix}gcc`]: tgcc,
		[`bin/${prefix}c++`]: tgcc,
		[`bin/${prefix}g++`]: tgcc,
	});
};

type LdProxyArg = {
	buildToolchain: std.env.Arg;
	build?: string;
	interpreter?: tg.File | undefined;
	interpreterArgs?: Array<tg.Template.Arg>;
	linker: tg.File | tg.Symlink | tg.Template;
	mandatoryLibraryPaths?: Array<tg.Directory>;
	host?: string;
};

export const ldProxy = async (arg: LdProxyArg) => {
	// Prepare the Tangram tools.
	const host = arg.host ?? (await std.triple.host());
	const build = arg.build ?? host;
	const buildToolchain = arg.buildToolchain;

	// Obtain wrapper components.

	// The linker proxy is built for the build machine.
	const buildLinkerProxy = await workspace.ldProxy({
		buildToolchain,
		build,
		host: build,
	});

	// The injection library and wrapper are built for the host machine.
	const hostInjectionLibrary = await injection({
		buildToolchain,
		build,
		host,
	});
	const hostWrapper = await workspace.wrapper({
		buildToolchain,
		build,
		host,
	});

	// Define environment for the linker proxy.
	const env = {
		TANGRAM_LINKER_COMMAND_PATH: tg.Mutation.setIfUnset<
			tg.File | tg.Symlink | tg.Template
		>(arg.linker),
		TANGRAM_LINKER_INJECTION_PATH: tg.Mutation.setIfUnset(hostInjectionLibrary),
		TANGRAM_LINKER_INTERPRETER_ARGS: arg.interpreterArgs
			? tg.Mutation.setIfUnset(arg.interpreterArgs)
			: undefined,
		TANGRAM_LINKER_INTERPRETER_PATH: tg.Mutation.setIfUnset<tg.File | "none">(
			arg.interpreter ?? "none",
		),
		TANGRAM_WRAPPER_ID: tg.Mutation.setIfUnset(await hostWrapper.id()),
	};

	// Create the linker proxy.
	return std.wrap(buildLinkerProxy, {
		buildToolchain,
		env,
		host: build,
		identity: "wrapper",
	});
};

type StripProxyArg = {
	build?: string;
	buildToolchain: std.env.Arg;
	host?: string;
	stripCommand: tg.File | tg.Symlink | tg.Template;
	runtimeLibraryPath?: tg.Directory | undefined;
};

export const stripProxy = async (arg: StripProxyArg) => {
	const { build: build_, buildToolchain, host: host_, stripCommand } = arg;

	const host = host_ ?? (await std.triple.host());
	const build = build_ ?? host;

	const hostWrapper = await workspace.wrapper({
		buildToolchain,
		build,
		host,
	});

	const stripProxy = await workspace.stripProxy({
		build,
		buildToolchain,
		host,
	});

	const envs: tg.Unresolved<Array<std.env.Arg>> = [
		{
			TANGRAM_STRIP_COMMAND_PATH: tg.Mutation.setIfUnset<
				tg.File | tg.Symlink | tg.Template
			>(stripCommand),
			TANGRAM_WRAPPER_ID: tg.Mutation.setIfUnset(await hostWrapper.id()),
		},
	];
	if (arg.runtimeLibraryPath !== undefined) {
		envs.push({
			TANGRAM_STRIP_RUNTIME_LIBRARY_PATH: arg.runtimeLibraryPath,
		});
	}

	return std.wrap(stripProxy, {
		buildToolchain,
		env: std.env.arg(...envs),
	});
};

export const test = tg.target(async () => {
	// const tests = [
	// 	testBasic(),
	// 	testTransitive(),
	// 	// testSamePrefix(),
	// 	// testSamePrefixDirect(),
	// ];
	// return await Promise.all(tests);
	return await testTransitive();
});

/** This test ensures the proxy produces a correct wrapper for a basic case with no transitive dynamic dependencies. */
export const testBasic = tg.target(async () => {
	const bootstrapSDK = await bootstrap.sdk();
	const helloSource = await tg.file(`
#include <stdio.h>
int main() {
	printf("Hello from a TGLD-wrapped binary!\\n");
	return 0;
}
	`);
	const output = await tg
		.target(
			tg`
				set -x
				/usr/bin/env
				cc -v -xc ${helloSource} -o $OUTPUT`,
			{
				env: await std.env.arg(bootstrapSDK, {
					TANGRAM_LD_PROXY_TRACING: "tangram=trace",
					TANGRAM_LINKER_LIBRARY_PATH_OPT_LEVEL: "combine",
					TANGRAM_WRAPPER_TRACING: "tangram=trace",
				}),
			},
		)
		.then((t) => t.output())
		.then(tg.File.expect);
	await std.assert.stdoutIncludes(output, "Hello from a TGLD-wrapped binary!");
	return output;
});

type MakeSharedArg = {
	flags?: Array<tg.Template.Arg>;
	libName: string;
	sdk: std.env.Arg;
	source: tg.File;
};

const makeShared = async (arg: tg.Unresolved<MakeSharedArg>) => {
	const { flags: flagArgs = [], libName, sdk, source } = await tg.resolve(arg);
	const flags = tg.Template.join(" ", ...flagArgs);
	const dylibExt =
		std.triple.os(await std.triple.host()) === "darwin" ? "dylib" : "so";
	return await tg
		.target(
			tg`mkdir -p $OUTPUT/lib && cc -shared -xc ${source} -o $OUTPUT/lib/${libName}.${dylibExt} ${flags}`,
			{
				env: std.env.arg(sdk),
			},
		)
		.then((t) => t.output())
		.then(tg.Directory.expect);
};

/** This test further exercises the the proxy by providing transitive dynamic dependencies both via -L and via -Wl,-rpath. */
export const testTransitive = tg.target(async () => {
	const bootstrapSDK = await bootstrap.sdk();
	const dylibExt =
		std.triple.os(await std.triple.host()) === "darwin" ? "dylib" : "so";
	const constantsSourceA = await tg.file(`
const char* getGreetingA() {
	return "Hello from transitive constants A!";
}
	`);
	const constantsHeaderA = await tg.file(`
const char* getGreetingA();
	`);

	let constantsA = await makeShared({
		libName: "libconstantsa",
		sdk: bootstrapSDK,
		source: constantsSourceA,
	});
	constantsA = await tg.directory(constantsA, {
		include: {
			"constantsa.h": constantsHeaderA,
		},
	});
	console.log("STRING CONSTANTS A", await constantsA.id());

	const constantsSourceB = await tg.file(`
const char* getGreetingB() {
	return "Hello from transitive constants B!";
}
		`);
	let constantsB = await makeShared({
		libName: "libconstantsb",
		sdk: bootstrapSDK,
		source: constantsSourceB,
	});
	const constantsHeaderB = await tg.file(`
const char* getGreetingB();
	`);
	constantsB = await tg.directory(constantsB, {
		include: {
			"constantsb.h": constantsHeaderB,
		},
	});
	console.log("STRING CONSTANTS B", await constantsB.id());

	const greetSourceA = await tg.file(`
	#include <stdio.h>
	#include <constantsa.h>
	void greet_a() {
		printf("%s\\n", getGreetingA());
	}
			`);
	const greetHeaderA = await tg.file(`
	void greet_a();
			`);
	let greetA = await makeShared({
		flags: [
			tg`-L${constantsA}/lib`,
			tg`-I${constantsA}/include`,
			"-lconstantsa",
		],
		libName: "libgreeta",
		sdk: bootstrapSDK,
		source: greetSourceA,
	});
	greetA = await tg.directory(greetA, {
		include: {
			"greeta.h": greetHeaderA,
		},
	});
	console.log("GREET A", await greetA.id());

	const greetSourceB = await tg.file(`
	#include <stdio.h>
	#include <constantsb.h>
	void greet_b() {
		printf("%s\\n", getGreetingB());
	}
			`);
	const greetHeaderB = await tg.file(`
	void greet_b();
			`);
	let greetB = await makeShared({
		flags: [
			tg`-L${constantsB}/lib`,
			tg`-I${constantsB}/include`,
			"-lconstantsb",
		],
		libName: "libgreetb",
		sdk: bootstrapSDK,
		source: greetSourceB,
	});
	greetB = await tg.directory(greetB, {
		include: {
			"greetb.h": greetHeaderB,
		},
	});
	console.log("GREET B", await greetB.id());

	const mainSource = await tg.file(`
	#include <greeta.h>
	#include <greetb.h>
	int main() {
		greet_a();
		greet_b();
		return 0;
	}
		`);
	const output = await tg
		.target(
			tg`cc -v -L${greetA}/lib -L${constantsA}/lib -lconstantsa -I${greetA}/include -lgreeta -I${constantsB}/include -L${constantsB}/lib -lconstantsb -I${greetB}/include -L${greetB}/lib -Wl,-rpath,${greetB}/lib ${greetB}/lib/libgreetb.${dylibExt} -lgreetb -xc ${mainSource} -o $OUTPUT`,
			{
				env: await std.env.arg(bootstrapSDK, {
					TANGRAM_LD_PROXY_TRACING: "tangram=trace",
					TANGRAM_LINKER_LIBRARY_PATH_OPT_LEVEL: "combine",
				}),
			},
		)
		.then((t) => t.output())
		.then(tg.File.expect);
	await std.assert.stdoutIncludes(
		output,
		"Hello from transitive constants A!\nHello from transitive constants B!",
	);
	return output;
});

/** This test checks that the common case of linking against a library in the working directory still works post-install. */
export const testSamePrefix = tg.target(async () => {
	const bootstrapSDK = await bootstrap.sdk();
	const dylibExt =
		std.triple.os(await std.triple.host()) === "darwin" ? "dylib" : "so";

	const greetSource = await tg.file(`
	#include <stdio.h>
	void greet() {
		printf("Hello from the shared library!\\n");
	}
			`);
	const greetHeader = await tg.file(`
	void greet();
			`);

	const mainSource = await tg.file(`
	#include <greet.h>
	int main() {
		greet();
		return 0;
	}
		`);
	const source = await tg.directory({
		"main.c": mainSource,
		"greet.c": greetSource,
		"greet.h": greetHeader,
	});

	const output = await tg
		.target(
			tg`
			set -x
			mkdir -p .bins
			mkdir -p .libs
			cd .libs
			cc -v -shared -xc ${source}/greet.c -Wl,-soname,libgreet.so.1 -o libgreet.${dylibExt}
			cd ../.bins
			cc -v -L../.libs -I${source} -lgreet -xc ${source}/main.c -o $OUTPUT
			`,
			{
				env: await std.env.arg(bootstrapSDK, {
					TANGRAM_LD_PROXY_TRACING: "tangram=trace",
					TANGRAM_LINKER_LIBRARY_PATH_OPT_LEVEL: "combine",
				}),
			},
		)
		.then((t) => t.output())
		.then(tg.File.expect);
	await std.assert.stdoutIncludes(output, "Hello from the shared library!");
	return output;
});

/** This test checks that the less-common case of linking against a library in the working directory by name instead of library path still works post-install. */
export const testSamePrefixDirect = tg.target(async () => {
	const bootstrapSDK = await bootstrap.sdk();
	const dylibExt =
		std.triple.os(await std.triple.host()) === "darwin" ? "dylib" : "so";

	const greetSource = await tg.file(`
	#include <stdio.h>
	void greet() {
		printf("Hello from the shared library!\\n");
	}
			`);
	const greetHeader = await tg.file(`
	void greet();
			`);

	const mainSource = await tg.file(`
	#include <greet.h>
	int main() {
		greet();
		return 0;
	}
		`);
	const source = await tg.directory({
		"main.c": mainSource,
		"greet.c": greetSource,
		"greet.h": greetHeader,
	});

	const output = await tg
		.target(
			tg`
			set -x
			mkdir -p .bins
			mkdir -p .libs
			cd .libs
			cc -v -shared -xc ${source}/greet.c -Wl,-soname,libgreet.so.1 -o libgreet.${dylibExt}
			cd ../.bins
			cc -v ../.libs/libgreet.${dylibExt} -I${source} -xc ${source}/main.c -o $OUTPUT
			`,
			{
				env: await std.env.arg(bootstrapSDK, {
					TANGRAM_LD_PROXY_TRACING: "tangram=trace",
					TANGRAM_LINKER_LIBRARY_PATH_OPT_LEVEL: "combine",
				}),
			},
		)
		.then((t) => t.output())
		.then(tg.File.expect);
	await std.assert.stdoutIncludes(output, "Hello from the shared library!");
	return output;
});

import inspectProcessSource from "../wrap/test/inspectProcess.c" with {
	type: "file",
};
export const testStrip = tg.target(async () => {
	const toolchain = await bootstrap.sdk();
	const output = await tg
		.target(
			tg`
		set -eux
		cc -g -o main -xc ${inspectProcessSource}
		strip main
		mv main $OUTPUT`,
			{
				env: std.env.arg(toolchain, {
					TANGRAM_STRIP_PROXY_TRACING: "tangram=trace",
				}),
			},
		)
		.then((t) => t.output())
		.then(tg.File.expect);
	return output;
});
