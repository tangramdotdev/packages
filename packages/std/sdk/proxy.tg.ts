import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.tg.ts";
import { injection } from "../wrap/injection.tg.ts";
import * as workspace from "../wrap/workspace.tg.ts";
import { wrapArgs } from "./gcc.tg.ts";

/** This module provides the Tangram proxy tools, which are used in conjunction with compilers and linkers to produce Tangram-ready artifacts. */

export type Arg = std.sdk.BuildEnvArg & {
	/** Should the compiler get proxied? Default: false. */
	compiler?: boolean;
	/** Should the linker get proxied? Default: true. */
	linker?: boolean;
	/** Optional linker to use. If omitted, the linker provided by the toolchain matching the requested arguments will be used. */
	linkerExe?: tg.File | tg.Symlink;
	/** The triple of the computer the toolchain being proxied produces binaries for. */
	target?: std.Triple.Arg;
};

/** Add a proxy to an env that provides a toolchain. */
export let env = tg.target(async (arg?: Arg): Promise<std.env.Arg> => {
	if (arg === undefined) {
		throw new Error("Cannot proxy an undefined env");
	}

	let proxyCompiler = arg.compiler ?? false;
	let proxyLinker = arg.linker ?? true;

	if (!proxyCompiler && !proxyLinker) {
		return;
	}

	if (!proxyLinker && arg.linkerExe !== undefined) {
		throw new Error(
			"Received a linkerExe argument, but linker is not being proxied",
		);
	}

	let dirs = [];

	let { cc, cxx, fortran, directory, flavor, host, ld, ldso, target } =
		await std.sdk.toolchainComponents({ env: arg.env, target: arg.target });

	if (proxyLinker) {
		let hostString = std.Triple.toString(host);
		let targetString = std.Triple.toString(target);

		let isCross = !std.Triple.eq(host, target);
		let targetPrefix = isCross ? `${targetString}-` : ``;

		// Construct the ld proxy.
		let ldProxyArtifact = await ldProxy({
			buildEnv: arg.env,
			linker: arg.linkerExe ?? ld,
			interpreter: ldso,
			host,
			target,
			sdk: arg.sdk,
		});

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
				let { ccArgs, cxxArgs, fortranArgs } = await wrapArgs({
					host,
					target,
					toolchainDir: directory,
				});
				wrappedCC = await std.wrap(cc, {
					identity: "wrapper",
					args: [tg`-B${ldProxyDir}`, ...(ccArgs ?? [])],
					sdk: arg.sdk,
				});
				wrappedCXX = await std.wrap(cxx, {
					identity: "wrapper",
					args: [tg`-B${ldProxyDir}`, ...(cxxArgs ?? [])],
					sdk: arg.sdk,
				});
				if (fortran) {
					wrappedGFortran = await std.wrap(fortran, {
						identity: "wrapper",
						args: [tg`-B${ldProxyDir}`, ...(fortranArgs ?? [])],
						sdk: arg.sdk,
					});
				}

				if (isCross) {
					binDir = tg.directory({
						bin: {
							[`${targetString}-cc`]: tg.symlink(`${targetPrefix}gcc`),
							[`${targetString}-c++`]: tg.symlink(`${targetPrefix}g++`),
							[`${targetString}-gcc`]: wrappedCC,
							[`${targetString}-g++`]: wrappedCXX,
						},
					});
					if (fortran) {
						binDir = tg.directory(binDir, {
							bin: {
								[`${targetString}-gfortran`]: wrappedGFortran,
							},
						});
					}
				} else {
					binDir = tg.directory({
						bin: {
							cc: tg.symlink("gcc"),
							[`${hostString}-cc`]: tg.symlink("gcc"),
							"c++": tg.symlink("g++"),
							[`${hostString}-c++`]: tg.symlink("g++"),
							gcc: wrappedCC,
							[`${hostString}-gcc`]: tg.symlink("gcc"),
							"g++": wrappedCXX,
							[`${hostString}-g++`]: tg.symlink("g++"),
						},
					});
					if (fortran) {
						binDir = tg.directory(binDir, {
							bin: {
								gfortran: wrappedGFortran,
								[`${hostString}-gfortran`]: tg.symlink("gfortran"),
							},
						});
					}
				}
				break;
			}
			case "llvm": {
				let clangArgs = [];
				if (host.os === "darwin") {
					clangArgs.push(tg`-resource-dir=${directory}/lib/clang/15.0.0`);
				}
				wrappedCC = std.wrap(cc, {
					args: [tg`-B${ldProxyArtifact}`, ...clangArgs],
					env: {
						SDKROOT: tg.Mutation.setIfUnset(bootstrap.macOsSdk()),
					},
				});
				wrappedCXX = wrappedCC;
				binDir = tg.directory({
					bin: {
						clang: wrappedCC,
						"clang++": wrappedCXX,
						cc: tg.symlink("clang"),
						"c++": tg.symlink("clang"),
						gcc: tg.symlink("clang"),
						"g++": tg.symlink("clang"),
					},
				});
			}
		}
		dirs.push(binDir);
	}

	if (proxyCompiler) {
		dirs.push(
			ccProxy({
				host,
				target,
				sdk: arg.sdk,
			}),
		);
	}

	return std.env.object(...dirs);
});

export default env;

type CcProxyArg = std.sdk.BuildEnvArg & {
	target?: std.Triple.Arg;
};

export let ccProxy = async (arg: CcProxyArg) => {
	let host = std.triple(arg.host);
	let target = std.triple(arg.target ?? host);
	let tgcc = workspace.tgcc({
		sdk: arg.sdk,
		host: target,
	});

	let isCross = !std.Triple.eq(host, target);
	let targetPrefix = isCross ? `${std.Triple.toString(target)}-` : ``;

	return tg.directory({
		[`bin/${targetPrefix}cc`]: tgcc,
		[`bin/${targetPrefix}gcc`]: tgcc,
		[`bin/${targetPrefix}c++`]: tgcc,
		[`bin/${targetPrefix}g++`]: tgcc,
	});
};

type LdProxyArg = {
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	buildEnv?: std.env.Arg;
	linker: tg.File | tg.Symlink;
	interpreter?: tg.File;
	interpreterArgs?: Array<tg.Template.Arg>;
	host: std.Triple.Arg;
	target?: std.Triple.Arg;
};

export let ldProxy = async (arg: LdProxyArg) => {
	// Prepare the Tangram tools.
	let host = std.triple(arg.host);
	let target = std.triple(arg.target ?? host);

	// Obtain wrapper components.
	let injectionLibrary = await injection({
		env: arg.buildEnv,
		host: target,
		sdk: arg.sdk,
	});
	let tgld = await workspace.tgld({
		host: target,
		sdk: arg.sdk,
	});
	let wrapper = await workspace.wrapper({
		host: target,
		sdk: arg.sdk,
	});

	// Create the linker proxy.
	let output = await std.wrap(tgld, {
		identity: "wrapper",
		env: {
			TANGRAM_LINKER_COMMAND_PATH: tg.Mutation.setIfUnset<tg.File | tg.Symlink>(
				arg.linker,
			),
			TANGRAM_LINKER_INJECTION_PATH: tg.Mutation.setIfUnset(injectionLibrary),
			TANGRAM_LINKER_INTERPRETER_ARGS: arg.interpreterArgs
				? tg.Mutation.setIfUnset(arg.interpreterArgs)
				: undefined,
			TANGRAM_LINKER_INTERPRETER_PATH: tg.Mutation.setIfUnset<tg.File | "none">(
				arg.interpreter ?? "none",
			),
			TANGRAM_LINKER_WRAPPER_PATH: tg.Mutation.setIfUnset(wrapper),
		},
		sdk: arg.sdk,
	});

	return output;
};

export let test = tg.target(async () => {
	let bootstrapSDK = await std.sdk({ bootstrapMode: true });
	let helloSource = await tg.file(`
#include <stdio.h>
int main() {
	printf("Hello from a TGLD-wrapped binary!\\n");
	return 0;
}
	`);
	let output = tg.File.expect(
		await tg.build(
			tg`
				set -x
				/usr/bin/env
				cc -v -xc ${helloSource} -o $OUTPUT`,
			{
				env: await std.env.object(bootstrapSDK, {
					TGLD_TRACING: "tangram=trace",
					TANGRAM_LINKER_LIBRARY_PATH_OPT_LEVEL: "combine",
					TANGRAM_WRAPPER_TRACING: "tangram=trace",
				}),
			},
		),
	);
	let result = tg.File.expect(
		await tg.build(tg`${output} > $OUTPUT`, {
			env: { TANGRAM_WRAPPER_TRACING: "tangram=trace" },
		}),
	);
	let text = await result.text();
	tg.assert(text.includes("Hello from a TGLD-wrapped binary!"));
	return output;
});
