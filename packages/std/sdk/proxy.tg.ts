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
export const env = async (arg?: Arg): Promise<std.env.Arg> => {
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

	return await std.env.arg(...dirs);
};

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
			? tg.Mutation.setIfUnset(tg.Template.join(" ", ...arg.interpreterArgs))
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

export const test = async () => {
	const tests = [
		testBasic(),
		testTransitiveAll(),
		testSamePrefix(),
		testSamePrefixDirect(),
		testDifferentPrefixDirect(),
		testSharedLibraryWithDep(),
		testStrip(),
	];
	return await Promise.all(tests);
};

/** This test ensures the proxy produces a correct wrapper for a basic case with no transitive dynamic dependencies. */
export const testBasic = async () => {
	const bootstrapSDK = await bootstrap.sdk();
	const helloSource = await tg.file(`
#include <stdio.h>
int main() {
	printf("Hello from a TGLD-wrapped binary!\\n");
	return 0;
}
	`);
	const output = await std.build`
				set -x
				/usr/bin/env
				cc -v -xc ${helloSource} -o $OUTPUT`
		.includeUtils(false)
		.pipefail(false)
		.env(
			std.env.arg(bootstrapSDK, {
				TANGRAM_LINKER_TRACING: "tangram_ld_proxy=trace",
				TANGRAM_LINKER_LIBRARY_PATH_OPT_LEVEL: "combine",
				TANGRAM_WRAPPER_TRACING: "tangram_wrapper=trace",
			}),
		)
		.then(tg.File.expect);
	await std.assert.stdoutIncludes(output, "Hello from a TGLD-wrapped binary!");
	return output;
};

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
	return await std.build`mkdir -p $OUTPUT/lib && cc -shared -xc ${source} -o $OUTPUT/lib/${libName}.${dylibExt} ${flags}`
		.bootstrap(true)
		.env(
			std.env.arg(sdk, {
				TANGRAM_LINKER_TRACING: "tangram_ld_proxy=trace",
			}),
		)
		.then(tg.Directory.expect);
};

export const testSharedLibraryWithDep = async () => {
	const bootstrapSdk = bootstrap.sdk();
	const dylibExt =
		std.triple.os(await std.triple.host()) === "darwin" ? "dylib" : "so";
	const constantsSource = await tg.file(`
const char* getGreetingA() {
	return "Hello from transitive constants A!";
}
	`);
	const constantsHeader = await tg.file(`
const char* getGreetingA();
	`);

	const printerSource = await tg.file(`
#include <stdio.h>
#include <constants.h>
void printGreeting() {
	printf("%s\\n", getGreetingA());
}
		`);
	const printerHeader = await tg.file(`
void printGreeting();
		`);

	const mainSource = await tg.file(`
		#include <printer.h>
		int main() {
			printGreeting();
			return 0;
		}
		`);

	const sources = tg.directory({
		["constants.c"]: constantsSource,
		["constants.h"]: constantsHeader,
		["printer.c"]: printerSource,
		["printer.h"]: printerHeader,
		["main.c"]: mainSource,
	});

	const output = await std.build`
		set -x
		mkdir -p $OUTPUT/bin
		mkdir -p $OUTPUT/lib
		mkdir -p $OUTPUT/include
		cp ${sources}/*.h $OUTPUT/include
		
		cc -shared -xc ${sources}/constants.c -o libconstants.${dylibExt}
		cc -shared -L. -I$OUTPUT/include -lconstants -xc ${sources}/printer.c -o libprinter.${dylibExt}
		cc -xc -L. -I$OUTPUT/include -lconstants -lprinter ${sources}/main.c -o main
		cp libconstants.${dylibExt} $OUTPUT/lib
		cp libprinter.${dylibExt} $OUTPUT/lib
		cp main $OUTPUT/bin
	`
		.bootstrap(true)
		.env(
			std.env.arg(bootstrapSdk, {
				TANGRAM_LINKER_TRACING: "tangram_ld_proxy=trace",
			}),
		)
		.then(tg.Directory.expect);

	console.log("STRING CONSTANTS A", await output.id());
	return output;
};

type OptLevel = "none" | "filter" | "resolve" | "isolate" | "combine";

export const testTransitiveAll = async () => {
	return await Promise.all([
		testTransitive(),
		testTransitiveNone(),
		testTransitiveResolve(),
		testTransitiveIsolate(),
		testTransitiveCombine(),
	]);
};
export const testTransitiveNone = () => testTransitive("none");
export const testTransitiveResolve = () => testTransitive("resolve");
export const testTransitiveIsolate = () => testTransitive("isolate");
export const testTransitiveCombine = () => testTransitive("combine");

/** This test further exercises the the proxy by providing transitive dynamic dependencies both via -L and via -Wl,-rpath. */
export const testTransitive = async (optLevel?: OptLevel) => {
	const opt = optLevel ?? "filter";
	const bootstrapSDK = await bootstrap.sdk();
	const os = std.triple.os(await std.triple.host());
	const dylibExt = os === "darwin" ? "dylib" : "so";

	// Define the sources.
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
	/* comment */
	int main() {
		greet_a();
		greet_b();
		return 0;
	}
		`);

	// Add a library path that doesn't get used to make sure it gets retained or removed appropriately.
	const uselessLibDir = tg.directory({ lib: tg.directory() });

	// Compile the executable.
	const output =
		await std.build`cc -v -L${greetA}/lib -L${constantsA}/lib -lconstantsa -I${greetA}/include -lgreeta -I${constantsB}/include -L${constantsB}/lib -lconstantsb -I${greetB}/include -L${greetB}/lib -Wl,-rpath,${greetB}/lib ${greetB}/lib/libgreetb.${dylibExt} -lgreetb -L${uselessLibDir}/lib -xc ${mainSource} -o $OUTPUT`
			.bootstrap(true)
			.env(
				std.env.arg(bootstrapSDK, {
					TANGRAM_LINKER_TRACING: "tangram_ld_proxy=trace",
					TANGRAM_LINKER_LIBRARY_PATH_OPT_LEVEL: opt,
				}),
			)
			.then(tg.File.expect);

	// Assert the library paths of the wrapper are set appropriately.
	const manifest = await std.wrap.Manifest.read(output);
	tg.assert(manifest !== undefined);
	const interpreter = manifest.interpreter;
	tg.assert(interpreter !== undefined);
	const expectedInterpreterKind = os === "darwin" ? "dyld" : "ld-musl";
	tg.assert(
		interpreter.kind === expectedInterpreterKind,
		`expected ${expectedInterpreterKind}, got ${interpreter.kind}`,
	);
	const libraryPaths = interpreter.libraryPaths;
	tg.assert(libraryPaths !== undefined);
	console.log("manifest library paths", libraryPaths);
	// NOTE - the input has six paths: libc, greeta, constantsa, greetb, constantsb, empty. The output will differ based on the opt level and OS.
	const numLibraryPaths = libraryPaths.length;
	console.log("numLibraryPaths", numLibraryPaths);
	switch (opt) {
		case "none": {
			// All the paths are retained.
			// On Linux, we get the 6 from our libraries plus an additional 4 from the toolchain, none of which are filtered out.
			const expectedNumLibraryPaths = os === "linux" ? 10 : 6;
			tg.assert(numLibraryPaths === expectedNumLibraryPaths);
			break;
		}
		case "filter": {
			// The empty path with no needed library was dropped.
			// On Linux, we also have a path for libc.
			const expectedNumLibraryPaths = os === "linux" ? 5 : 4;
			tg.assert(numLibraryPaths === expectedNumLibraryPaths);
			// each path should have a single directory component and optionally a single string component.
			for (let path of libraryPaths) {
				const pathLength = path.components.length;
				tg.assert(pathLength === 1 || pathLength === 2);
				const artifactComponent = path.components[0];
				tg.assert(artifactComponent !== undefined);
				tg.assert(artifactComponent.kind === "artifact");
				tg.assert(artifactComponent.value.startsWith("dir_"));
				if (pathLength === 2) {
					const subpathComponent = path.components[1];
					tg.assert(subpathComponent !== undefined);
					tg.assert(subpathComponent.kind === "string");
					tg.assert(subpathComponent.value === "/lib");
				}
			}
			break;
		}
		case "resolve": {
			// The empty path with no needed library was dropped.
			// On Linux, we also have a path for libc.
			const expectedNumLibraryPaths = os === "linux" ? 5 : 4;
			tg.assert(numLibraryPaths === expectedNumLibraryPaths);
			// each path should have a single directory component.
			for (let path of libraryPaths) {
				tg.assert(path.components.length === 1);
				const component = path.components[0];
				tg.assert(component !== undefined);
				tg.assert(component.kind === "artifact");
				tg.assert(component.value.startsWith("dir_"));
			}
			break;
		}
		case "isolate": {
			// There are as many library paths as libraries.
			// On Linux, we also have a path for libc.
			const expectedNumLibraryPaths = os === "linux" ? 5 : 4;
			tg.assert(numLibraryPaths === expectedNumLibraryPaths);
			// each path should have a single directory component.
			for (let path of libraryPaths) {
				tg.assert(path.components.length === 1);
				const component = path.components[0];
				tg.assert(component !== undefined);
				tg.assert(component.kind === "artifact");
				tg.assert(component.value.startsWith("dir_"));
			}
			break;
		}
		case "combine": {
			// There is one single library path.
			tg.assert(numLibraryPaths === 1);
			const path = libraryPaths[0];
			tg.assert(path !== undefined);
			// it should be a single directory component, and that diretory should contain all libraries.
			tg.assert(path.components.length === 1);
			const component = path.components[0];
			tg.assert(component !== undefined);
			tg.assert(component.kind === "artifact");
			tg.assert(component.value.startsWith("dir_"));
			const combinedDir = tg.Directory.withId(component.value);
			const entries = await combinedDir.entries();

			const expectedNumEntries = os === "linux" ? 5 : 4;
			tg.assert(Object.keys(entries).length === expectedNumEntries);
			if (os === "linux") {
				const libc = await combinedDir.tryGet("libc.so");
				tg.assert(libc instanceof tg.File);
			}
			const libgreeta = await combinedDir.tryGet(`libgreeta.${dylibExt}`);
			tg.assert(libgreeta instanceof tg.File);
			const libconstantsa = await combinedDir.tryGet(
				`libconstantsa.${dylibExt}`,
			);
			tg.assert(libconstantsa instanceof tg.File);
			const libgreetb = await combinedDir.tryGet(`libgreetb.${dylibExt}`);
			tg.assert(libgreetb instanceof tg.File);
			const libconstantsb = await combinedDir.tryGet(
				`libconstantsb.${dylibExt}`,
			);
			tg.assert(libconstantsb instanceof tg.File);
			break;
		}
		default: {
			return tg.unreachable(`unrecognized opt level ${opt}`);
		}
	}

	// Make sure the executable runs without errors and produces the expected output.
	await std.assert.stdoutIncludes(
		output,
		"Hello from transitive constants A!\nHello from transitive constants B!",
	);

	return output;
};

/** This test checks that the common case of linking against a library in the working directory still works post-install. */
export const testSamePrefix = async () => {
	const bootstrapSDK = await bootstrap.sdk();
	const os = std.triple.os(await std.triple.host());
	const dylibExt = os === "darwin" ? "dylib" : "so";
	const dylibLinkerFlag = os === "darwin" ? "install_name" : "soname";
	const versionedDylibExt = os === "darwin" ? `1.${dylibExt}` : `${dylibExt}.1`;

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

	const output = await std.build`
			set -x
			env
			mkdir -p .bins
			mkdir -p .libs
			cd .libs
			cc -v -shared -xc ${source}/greet.c -Wl,-${dylibLinkerFlag},libgreet.${versionedDylibExt} -o libgreet.${dylibExt}
			cd ../.bins
			cc -v -L../.libs -I${source} -lgreet -xc ${source}/main.c -o $OUTPUT
			`
		.bootstrap(true)
		.env(
			std.env.arg(bootstrapSDK, {
				TANGRAM_LINKER_TRACING: "tangram_ld_proxy=trace",
				TANGRAM_LINKER_LIBRARY_PATH_OPT_LEVEL: "combine",
			}),
		)
		.then(tg.File.expect);
	console.log("wrapped_exe", await output.id());
	await std.assert.stdoutIncludes(output, "Hello from the shared library!");
	return output;
};

/** This test checks that the less-common case of linking against a library in the working directory by name instead of library path still works post-install. */
export const testSamePrefixDirect = async () => {
	const bootstrapSDK = await bootstrap.sdk();
	const os = std.triple.os(await std.triple.host());
	const dylibExt = os === "darwin" ? "dylib" : "so";
	const dylibLinkerFlag = os === "darwin" ? "install_name" : "soname";
	const versionedDylibExt = os === "darwin" ? `1.${dylibExt}` : `${dylibExt}.1`;

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

	const output = await std.build`
			set -x
			mkdir -p .bins
			mkdir -p .libs
			cd .libs
			cc -v -shared -xc ${source}/greet.c -Wl,-${dylibLinkerFlag},libgreet.${versionedDylibExt} -o libgreet.${dylibExt}
			cd ../.bins
			cc -v ../.libs/libgreet.${dylibExt} -I${source} -xc ${source}/main.c -o $OUTPUT
			`
		.bootstrap(true)
		.env(
			std.env.arg(bootstrapSDK, {
				TANGRAM_LINKER_TRACING: "tangram_ld_proxy=trace",
				TANGRAM_LINKER_LIBRARY_PATH_OPT_LEVEL: "combine",
			}),
		)
		.then(tg.File.expect);
	await std.assert.stdoutIncludes(output, "Hello from the shared library!");
	return output;
};

/** This test checks that the less-common case of linking against a library in a different Tangram artifact by name instead of library path still works post-install. */
export const testDifferentPrefixDirect = async () => {
	const bootstrapSDK = await bootstrap.sdk();
	const os = std.triple.os(await std.triple.host());
	const dylibExt = os === "darwin" ? "dylib" : "so";
	const dylibLinkerFlag = os === "darwin" ? "install_name" : "soname";
	const versionedDylibExt = os === "darwin" ? `1.${dylibExt}` : `${dylibExt}.1`;

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

	const libgreetArtifact = await std.build`
			set -x
			mkdir -p $OUTPUT
			cc -v -shared -xc ${source}/greet.c -Wl,-${dylibLinkerFlag},libgreet.${versionedDylibExt} -o $OUTPUT/libgreet.${dylibExt}
			`
		.bootstrap(true)
		.env(
			std.env.arg(bootstrapSDK, {
				TANGRAM_LINKER_TRACING: "tangram_ld_proxy=trace",
				TANGRAM_LINKER_LIBRARY_PATH_OPT_LEVEL: "combine",
			}),
		)
		.then(tg.Directory.expect);

	const output = await std.build`
			set -x
			cc -v ${libgreetArtifact}/libgreet.${dylibExt} -I${source} -xc ${source}/main.c -o $OUTPUT
			`
		.bootstrap(true)
		.env(
			std.env.arg(bootstrapSDK, {
				TANGRAM_LINKER_TRACING: "tangram_ld_proxy=trace",
				TANGRAM_LINKER_LIBRARY_PATH_OPT_LEVEL: "combine",
			}),
		)
		.then(tg.File.expect);
	await std.assert.stdoutIncludes(output, "Hello from the shared library!");
	return output;
};

import inspectProcessSource from "../wrap/test/inspectProcess.c" with {
	type: "file",
};

export const testStrip = async () => {
	const toolchain = await bootstrap.sdk();
	const output = await std.build`
		set -x
		cc -g -o main -xc ${inspectProcessSource}
		strip main
		mv main $OUTPUT`
		.bootstrap(true)
		.env(
			std.env.arg(toolchain, {
				TANGRAM_STRIP_PROXY_TRACING: "tangram_strip_proxy=trace",
			}),
		)
		.then(tg.File.expect);
	return output;
};
