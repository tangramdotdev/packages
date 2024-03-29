import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.tg.ts";
import { injection } from "../wrap/injection.tg.ts";
import * as workspace from "../wrap/workspace.tg.ts";
import * as gcc from "./gcc.tg.ts";
import * as llvmToolchain from "./llvm.tg.ts";

/** This module provides the Tangram proxy tools, which are used in conjunction with compilers and linkers to produce Tangram-ready artifacts. */

export type Arg = {
	/** Relax checks of build toolchain, assumes it's the bootstrap. */
	bootstrapMode?: boolean;
	/** The build environment to use to produce components. */
	buildToolchain: std.env.Arg;
	/** The target triple of the build machine. */
	build?: string;
	/** Should the compiler get proxied? Default: false. */
	compiler?: boolean;
	/** Should we expect an LLVM toolchain? */
	llvm?: boolean;
	/** Should the linker get proxied? Default: true. */
	linker?: boolean;
	/** Optional linker to use. If omitted, the linker provided by the toolchain matching the requested arguments will be used. */
	linkerExe?: tg.File | tg.Symlink;
	/** The triple of the computer the toolchain being proxied produces binaries for. */
	host?: string;
};

/** Add a proxy to an env that provides a toolchain. */
export let env = tg.target(async (arg?: Arg): Promise<std.env.Arg> => {
	if (arg === undefined) {
		throw new Error("Cannot proxy an undefined env");
	}

	let bootstrapMode = arg.bootstrapMode ?? false;
	let proxyCompiler = arg.compiler ?? false;
	let proxyLinker = arg.linker ?? true;
	let llvm = arg.llvm ?? false;
	let buildToolchain = arg.buildToolchain;

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

	let {
		cc: cc_,
		cxx: cxx_,
		fortran,
		directory,
		flavor,
		ld,
		ldso,
	} = await std.sdk.toolchainComponents({
		bootstrapMode,
		env: buildToolchain,
		host,
		target: host,
	});

	let cc: tg.File | tg.Symlink = cc_;
	let cxx: tg.File | tg.Symlink = cxx_;

	if (proxyLinker) {
		let isCross = build !== host;
		let prefix = isCross ? `${host}-` : ``;

		// Construct the ld proxy.
		let ldProxyArtifact = await ldProxy({
			buildToolchain,
			build,
			linker: arg.linkerExe ?? (llvm ? await tg`${directory}/bin/ld.lld` : ld),
			interpreter: ldso,
			host,
		});

		let linkerName = "ld";
		if (llvm) {
			cc = tg.File.expect(
				await directory.get(`bin/clang-${llvmToolchain.llvmMajorVersion()}`),
			);
			cxx = cc;
		}
		let ldProxyDir = tg.directory({
			[linkerName]: ldProxyArtifact,
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
					identity: "wrapper",
				});
				wrappedCXX = await std.wrap(cxx, {
					args: [tg`-B${ldProxyDir}`, ...(cxxArgs ?? [])],
					buildToolchain,
					identity: "wrapper",
				});
				if (fortran) {
					wrappedGFortran = await std.wrap(fortran, {
						args: [tg`-B${ldProxyDir}`, ...(fortranArgs ?? [])],
						buildToolchain,
						identity: "wrapper",
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
				wrappedCC = std.wrap(cc, {
					args: [tg`-B${ldProxyDir}`, ...clangArgs],
					buildToolchain,
					env,
				});
				wrappedCXX = std.wrap(cxx, {
					args: [tg`-B${ldProxyDir}`, ...clangxxArgs],
					buildToolchain,
					env,
				});
				binDir = tg.directory({
					bin: {
						clang: wrappedCC,
						"clang++": wrappedCXX,
						cc: tg.symlink("clang"),
						"c++": tg.symlink("clang++"),
						gcc: tg.symlink("clang"),
						"g++": tg.symlink("clang++"),
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

	return std.env.object(...dirs);
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
	interpreter?: tg.File;
	interpreterArgs?: Array<tg.Template.Arg>;
	linker: tg.File | tg.Symlink | tg.Template;
	host?: string;
};

export let ldProxy = async (arg: LdProxyArg) => {
	// Prepare the Tangram tools.
	let host = arg.host ?? await std.triple.host();
	let build = arg.build ?? host;
	let buildToolchain = arg.buildToolchain;

	// Obtain wrapper components.
	let injectionLibrary = await injection({
		buildToolchain,
		build,
		host,
	});
	let tgld = await workspace.tgld({
		buildToolchain,
		build,
		host,
	});
	let wrapper = await workspace.wrapper({
		buildToolchain,
		build,
		host,
	});

	// Create the linker proxy.
	let output = await std.wrap({
		buildToolchain,
		env: {
			TANGRAM_LINKER_COMMAND_PATH: tg.Mutation.setIfUnset<
				tg.File | tg.Symlink | tg.Template
			>(arg.linker),
			TANGRAM_LINKER_INJECTION_PATH: tg.Mutation.setIfUnset(injectionLibrary),
			TANGRAM_LINKER_INTERPRETER_ARGS: arg.interpreterArgs
				? tg.Mutation.setIfUnset(arg.interpreterArgs)
				: undefined,
			TANGRAM_LINKER_INTERPRETER_PATH: tg.Mutation.setIfUnset<tg.File | "none">(
				arg.interpreter ?? "none",
			),
			TANGRAM_LINKER_WRAPPER_PATH: tg.Mutation.setIfUnset(wrapper),
		},
		executable: tgld,
		identity: "wrapper",
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
					TANGRAM_LD_PROXY_TRACING: "tangram=trace",
					TANGRAM_LINKER_LIBRARY_PATH_OPT_LEVEL: "combine",
					TANGRAM_WRAPPER_TRACING: "tangram=trace",
				}),
			},
		),
	);
	let result = tg.File.expect(
		await tg.build(tg`${output} > $OUTPUT`, {
			env: {
				TANGRAM_WRAPPER_TRACING: "tangram=trace",
			},
		}),
	);
	let text = await result.text();
	tg.assert(text.includes("Hello from a TGLD-wrapped binary!"));
	return output;
});
