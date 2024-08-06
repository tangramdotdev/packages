import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.tg.ts";
import { injection } from "../wrap/injection.tg.ts";
import * as workspace from "../wrap/workspace.tg.ts";
import * as gcc from "./gcc.tg.ts";
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
	/** The build environment to be proxied. */
	toolchain: std.env.Arg;
};

/** Add a proxy to an env that provides a toolchain. */
export let env = tg.target(async (arg?: Arg): Promise<std.env.Arg> => {
	if (arg === undefined) {
		throw new Error("Cannot proxy an undefined env");
	}

	let proxyCompiler = arg.compiler ?? false;
	let proxyLinker = arg.linker ?? true;
	let buildToolchain = arg.toolchain;

	if (!proxyCompiler && !proxyLinker) {
		return;
	}

	if (!proxyLinker && arg.linkerExe !== undefined) {
		throw new Error(
			"Received a linkerExe argument, but linker is not being proxied",
		);
	}

	let dirs = [];

	let host = arg.host ?? (await std.triple.host());
	let build = arg.build ?? host;
	let os = std.triple.os(host);
	let forcePrefix = arg.forcePrefix ?? false;

	let {
		cc: cc_,
		cxx: cxx_,
		fortran,
		directory,
		flavor,
		ld,
		ldso,
	} = await std.sdk.toolchainComponents({
		env: buildToolchain,
		forcePrefix,
		host: build,
		target: host,
	});

	let cc: tg.File | tg.Symlink = cc_;
	let cxx: tg.File | tg.Symlink = cxx_;
	let isLlvm = flavor === "llvm";

	if (proxyLinker) {
		let isCross = build !== host;
		let prefix = isCross ? `${host}-` : ``;

		// Construct the ld proxy.
		let ldProxyArtifact = await ldProxy({
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
		let ldProxyDir = tg.directory({
			ld: ldProxyArtifact,
		});

		// Construct wrappers that always pass the ld proxy.
		let binDir = tg.directory();

		let wrappedCC;
		let wrappedCXX;
		let wrappedGFortran;
		switch (flavor) {
			case "gcc": {
				let { ccArgs, cxxArgs, fortranArgs } = await gcc.wrapArgs({
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
				let { clangArgs, clangxxArgs, env } = await llvmToolchain.wrapArgs({
					host: build,
					target: host,
					toolchainDir: directory,
				});
				// On Linux, don't wrap in place.
				let merge = os === "darwin";
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

	return std.env.arg(...dirs);
});

export default env;

type CcProxyArg = {
	buildToolchain: std.env.Arg;
	build?: string;
	host?: string;
};

export let ccProxy = async (arg: CcProxyArg) => {
	let host = arg.host ?? (await std.triple.host());
	let build = arg.build ?? host;
	let buildToolchain = arg.buildToolchain;
	let tgcc = workspace.tgcc({
		buildToolchain,
		build,
		host,
	});

	let isCross = build !== host;
	let prefix = isCross ? `${host}-` : ``;

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

export let ldProxy = async (arg: LdProxyArg) => {
	// Prepare the Tangram tools.
	let host = arg.host ?? (await std.triple.host());
	let build = arg.build ?? host;
	let buildToolchain = arg.buildToolchain;

	// Obtain wrapper components.

	// The linker proxy is built for the build machine.
	let buildLinkerProxy = await workspace.tgld({
		buildToolchain,
		build,
		host: build,
	});

	// The injection library and wrapper are built for the host machine.
	let hostInjectionLibrary = await injection({
		buildToolchain,
		build,
		host,
	});
	let hostWrapper = await workspace.wrapper({
		buildToolchain,
		build,
		host,
	});

	// Define environment for the linker proxy.
	let env = {
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
		TANGRAM_LINKER_WRAPPER_ID: tg.Mutation.setIfUnset(await hostWrapper.id()),
	};

	// Create the linker proxy.
	return std.wrap(buildLinkerProxy, {
		buildToolchain,
		env,
		host: build,
		identity: "wrapper",
	});
};

export let test = tg.target(async () => {
	let basicResult = await testBasic();
	console.log("basic result", await basicResult.id());
	let transitiveResult = await testTransitive();
	console.log("transitive result", await transitiveResult.id());
	return transitiveResult;
});

/** This test ensures the proxy produces a correct wrapper for a basic case with no transitive dynamic dependencies. */
export let testBasic = tg.target(async () => {
	let bootstrapSDK = await bootstrap.sdk();
	let helloSource = await tg.file(`
#include <stdio.h>
int main() {
	printf("Hello from a TGLD-wrapped binary!\\n");
	return 0;
}
	`);
	let output = await tg
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
	let manifest = await std.wrap.Manifest.read(output);
	console.log("\n\nMANIFEST", manifest);
	let result = await tg
		.target(tg`${output} > $OUTPUT`, {
			env: {
				TANGRAM_WRAPPER_TRACING: "tangram=trace",
			},
		})
		.then((t) => t.output())
		.then(tg.File.expect);
	let text = await result.text();
	tg.assert(text.includes("Hello from a TGLD-wrapped binary!"));
	return output;
});

type MakeSharedArg = {
	flags?: Array<tg.Template.Arg>;
	libName: string;
	sdk: std.env.Arg;
	source: tg.File;
};

let makeShared = async (arg: tg.Unresolved<MakeSharedArg>) => {
	let { flags: flagArgs = [], libName, sdk, source } = await tg.resolve(arg);
	let flags = tg.Template.join(" ", ...flagArgs);
	let dylibExt =
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
export let testTransitive = tg.target(async () => {
	let bootstrapSDK = await bootstrap.sdk();
	let constantsSourceA = await tg.file(`
const char* getGreeting() {
	return "Hello from transitive constants A!";
}
	`);
	let constantsHeader = await tg.file(`
const char* getGreeting();
	`);

	let constantsA = await makeShared({
		libName: "libconstantsa",
		sdk: bootstrapSDK,
		source: constantsSourceA,
	});
	constantsA = await tg.directory(constantsA, {
		include: {
			"constants.h": constantsHeader,
		},
	});
	console.log("STRING CONSTANTS A", await constantsA.id());

	let constantsSourceB = await tg.file(`
const char* getGreeting() {
	return "Hello from transitive constants B!";
}
		`);
	let constantsB = await makeShared({
		libName: "libconstantsb",
		sdk: bootstrapSDK,
		source: constantsSourceB,
	});
	constantsB = await tg.directory(constantsB, {
		include: {
			"constants.h": constantsHeader,
		},
	});
	console.log("STRING CONSTANTS B", await constantsB.id());

	let greetSourceA = await tg.file(`
	#include <stdio.h>
	#include <constants.h>
	void greet_a() {
		printf("%s\\n", getGreeting());
	}
			`);
	let greetHeaderA = await tg.file(`
	const char* greet_a();
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

	let greetSourceB = await tg.file(`
	#include <stdio.h>
	#include <constants.h>
	void greet_b() {
		printf("%s\\n", getGreeting());
	}
			`);
	let greetHeaderB = await tg.file(`
	const char* greet_b();
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

	let mainSource = await tg.file(`
	#include <stdio.h>
	#include <greeta.h>
	#include <greetb.h>
	int main() {
		greet_a();
		greet_b();
		return 0;
	}
		`);
	let output = await tg
		.target(
			tg`cc -v -L${greetA}/lib -L${constantsA}/lib -lconstantsa -I${greetA}/include -lgreeta -I${constantsB}/include -L${constantsB}/lib -I${greetB}/include -L${greetB}/lib -Wl,-rpath,${greetB}/lib ${greetB}/lib/libgreetb.so -lgreetb -xc ${mainSource} -o $OUTPUT`,
			{
				env: await std.env.arg(bootstrapSDK, {
					TANGRAM_LD_PROXY_TRACING: "tangram=trace",
					TANGRAM_LINKER_LIBRARY_PATH_OPT_LEVEL: "combine",
				}),
			},
		)
		.then((t) => t.output())
		.then(tg.File.expect);
	let manifest = await std.wrap.Manifest.read(output);
	console.log("\n\nMANIFEST", manifest);
	let result = tg.File.expect(
		await (
			await tg.target(tg`${output} > $OUTPUT`, {
				env: {
					TANGRAM_WRAPPER_TRACING: "tangram=trace",
				},
			})
		).output(),
	);
	let text = await result.text();
	tg.assert(
		text.includes(
			"Hello from transitive constants A!\nHello from transitive constants B!",
		),
	);
	return output;
});
