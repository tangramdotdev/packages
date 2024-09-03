/** This module provides environments ready to produce Tangram-wrapped executables from C and C++ code. */

import * as bootstrap from "./bootstrap.tg.ts";
import binutils from "./sdk/gnu/binutils.tg.ts";
import * as gnu from "./sdk/gnu.tg.ts";
import * as libc from "./sdk/libc.tg.ts";
import * as llvm from "./sdk/llvm.tg.ts";
import mold from "./sdk/mold.tg.ts";
import * as proxy from "./sdk/proxy.tg.ts";
import * as std from "./tangram.tg.ts";

/** An SDK combines a compiler, a linker, a libc, and a set of basic utilities. */
export async function sdk(...args: std.args.UnresolvedArgs<sdk.Arg>) {
	let {
		host,
		proxy: proxyArg,
		targets,
		toolchain: toolchain_,
		linker,
	} = await sdk.arg(...args);

	let hostOs = std.triple.os(host);

	// Create an array to collect all constituent envs.
	let envs: tg.Unresolved<std.Args<std.env.Arg>> = [];

	// Determine host toolchain.
	let toolchain: std.env.Arg;
	if (toolchain_ === "gnu") {
		if (hostOs === "darwin") {
			throw new Error(`The GCC toolchain is not available on macOS.`);
		}
		toolchain = await gnu.toolchain({ host });
	} else if (toolchain_ === "llvm") {
		toolchain = await llvm.toolchain({ host });
	} else {
		toolchain = toolchain_;
	}
	envs.push(toolchain);

	let { flavor } = await std.sdk.toolchainComponents({
		env: toolchain,
		host,
	});

	// Set CC/CXX.
	if (flavor === "gnu") {
		envs.push({
			CC: tg.Mutation.setIfUnset(`gcc`),
			CXX: tg.Mutation.setIfUnset(`g++`),
		});
	} else if (flavor === "llvm") {
		envs.push({
			CC: tg.Mutation.setIfUnset("clang"),
			CXX: tg.Mutation.setIfUnset("clang++"),
		});
	}

	// Swap linker if requested.
	let linkerDir: tg.Directory | undefined = undefined;
	let linkerExe: tg.File | tg.Symlink | tg.Template | undefined = undefined;
	if (linker) {
		if (linker instanceof tg.Symlink || linker instanceof tg.File) {
			linkerExe = linker;
		} else {
			switch (linker) {
				case "bfd": {
					if (flavor === "llvm") {
						let binutilsDir = await binutils({ host });
						linkerDir = binutilsDir;
						linkerExe = tg.File.expect(await binutilsDir.get("bin/ld"));
					}
					break;
				}
				case "lld": {
					if (flavor === "gnu") {
						linkerExe = await llvm.lld({ host });
					}
					break;
				}
				case "mold": {
					let moldArtifact = await mold({ host });
					linkerDir = moldArtifact;
					linkerExe = tg.File.expect(await moldArtifact.get("bin/mold"));
					break;
				}
			}
		}
	}

	// Proxy the host toolchain.
	proxyArg = { ...proxyArg, toolchain: toolchain, host };
	if (linkerExe) {
		proxyArg = { ...proxyArg, linkerExe };
	}
	let hostProxy = await proxy.env(proxyArg as proxy.Arg);
	envs.push(hostProxy);
	if (linkerDir) {
		envs.push(linkerDir);
	}

	// Add cross compilers if requested.
	for (let target of targets) {
		if (host === target) {
			continue;
		}
		if (!validateCrossTarget({ host, target })) {
			throw new Error(
				`Cross-compiling from ${host} to ${target} is not supported.`,
			);
		}
		let crossToolchain = undefined;
		if (std.triple.os(host) === "linux" && std.triple.os(target) === "darwin") {
			crossToolchain = await llvm.linuxToDarwin({ host, target });
		} else {
			crossToolchain = await gnu.toolchain({ host, target });
		}
		tg.assert(crossToolchain !== undefined);
		envs.push(crossToolchain);
		let proxyEnv = await proxy.env({
			...proxyArg,
			toolchain: crossToolchain,
			build: host,
			host: target,
		});
		envs.push(proxyEnv);
		let targetEnvVarName = target.replace(/-/g, "_").toUpperCase();
		envs.push({
			[`AR_${targetEnvVarName}`]: tg.Mutation.setIfUnset(`${target}-ar`),
			[`CC_${targetEnvVarName}`]: tg.Mutation.setIfUnset(`${target}-gcc`),
			[`CXX_${targetEnvVarName}`]: tg.Mutation.setIfUnset(`${target}-g++`),
		});
	}

	// Combine all envs.
	return await std.env.arg(...envs);
}

export namespace sdk {
	/** The possible types to pass to `std.sdk()`. Pass `undefined` or `true` to get the default SDK, `false` for an empty env, or use the `ArgObject` to configure the provided env. */
	export type Arg = undefined | ArgObject;

	export type ArgObject = {
		/** The machine this SDK will compile on. */
		host?: string;
		/** An alternate linker to use. */
		linker?: LinkerKind | undefined;
		/** Which components should get proxied. Use `true` or `false` as a shorthand for enabling or disabling all proxies. If not provided, the default behavior is to proxy the linker but not the compiler. */
		proxy?: Partial<proxy.Arg> | boolean;
		/** The machine this SDK produces executables for. */
		target?: string;
		/** A list of machines this SDK can produce executables for. */
		targets?: Array<string>;
		/** Env containing the compiler. If not provided, will default to a native GCC toolchain. */
		toolchain?: sdk.ToolchainKind;
	};

	export let arg = async (...args: std.args.UnresolvedArgs<Arg>) => {
		let objectArgs = await Promise.all(
			std.flatten(await Promise.all(args.map(tg.resolve))).map(async (arg) => {
				if (arg === undefined) {
					return {};
				} else {
					return arg;
				}
			}),
		);
		let mutationArgs = await std.args.createMutations<sdk.ArgObject>(
			objectArgs,
			{
				proxy: (arg) => {
					if (typeof arg === "boolean") {
						let proxyArg = arg
							? { compiler: true, linker: true }
							: { compiler: false, linker: false };
						return tg.Mutation.set(proxyArg);
					} else {
						return tg.Mutation.set(arg as proxy.Arg);
					}
				},
				targets: "append",
			},
		);
		let {
			host: host_,
			linker,
			proxy: proxyArg_,
			target,
			targets: targets_,
			toolchain: toolchain_,
		} = await std.args.applyMutations(mutationArgs);

		tg.assert(typeof proxyArg_ === "object" || proxyArg_ === undefined);

		// Obtain host and targets.
		let host = host_ ?? (await std.triple.host());
		let hostOs = std.triple.os(host);

		if (hostOs === "darwin" && linker && linker !== "lld") {
			throw new Error(`Alternate linkers are only available for Linux hosts.`);
		}

		let targets = targets_ ?? [];
		if (target) {
			targets.push(target);
		}

		// Set the default proxy arguments.
		let proxyArg = proxyArg_ ?? { compiler: false, linker: true, strip: true };

		// Set the default toolchain if not provided.
		if (toolchain_ === undefined) {
			toolchain_ = hostOs === "darwin" ? "llvm" : "gnu";
		}

		// If we're building our own toolchain, canonicalize the host and targets.
		if (toolchain_ === "gnu" || toolchain_ === "llvm") {
			host = sdk.canonicalTriple(host);
			targets = targets.map(sdk.canonicalTriple);
		}

		return {
			host,
			proxy: proxyArg,
			targets,
			toolchain: toolchain_,
			linker,
		};
	};

	///////// QUERIES

	type ProvidesToolchainArg = {
		env: std.env.Arg;
		forcePrefix?: boolean;
		host?: string | undefined;
		target?: string | undefined;
	};

	let requiredCompilerComponents = (os: string, flavor: "gnu" | "llvm") => {
		let cc = flavor === "llvm" ? "clang" : "gcc";
		let cxx = flavor === "llvm" ? "clang++" : "g++";
		let ld = os === "linux" && flavor === "llvm" ? "ld.lld" : "ld";
		return [cc, cxx, ld];
	};

	let requiredUtils = ["ar", "nm", "ranlib", "strip"] as const;

	/** Assert that an env provides an toolchain. */
	export let assertProvidesToolchain = async (arg: ProvidesToolchainArg) => {
		let { env, forcePrefix = false, host: host_, target: target_ } = arg;

		let llvm = await std.env.provides({ env, names: ["clang"] });

		let host = canonicalTriple(host_ ?? (await std.triple.host()));
		let target = canonicalTriple(target_ ?? host);
		let os = std.triple.os(target);
		let isCross = host !== target;
		// Provides binutils, cc/c++.
		let targetPrefix = ``;
		if (forcePrefix || isCross) {
			targetPrefix = `${target}-`;
		}
		await std.env.assertProvides({
			env,
			names: requiredUtils.map((name) => `${targetPrefix}${name}`),
		});
		let compilerComponents = requiredCompilerComponents(
			os,
			llvm ? "llvm" : "gnu",
		);
		await std.env.assertProvides({
			env,
			names: compilerComponents.map((name) => `${targetPrefix}${name}`),
		});
		return true;
	};

	/** Determine whether an env provides an toolchain. */
	export let providesToolchain = async (
		arg: ProvidesToolchainArg,
	): Promise<boolean> => {
		let { env, forcePrefix, target } = arg;
		let os = std.triple.os(target ?? (await std.triple.host()));
		let targetPrefix = ``;
		if (target) {
			if (forcePrefix || os !== "darwin") {
				targetPrefix = `${target}-`;
			}
		}
		let llvm = await std.env.provides({ env, names: ["clang"] });
		let compilerComponents = requiredCompilerComponents(
			os,
			llvm ? "llvm" : "gnu",
		);
		if (llvm) {
			return std.env.provides({
				env,
				names: compilerComponents,
			});
		} else {
			return std.env.provides({
				env,
				names: compilerComponents.map((name) => `${targetPrefix}${name}`),
			});
		}
	};

	/** Locate the C and C++ compilers, linker, and ld.so from a toolchain. */
	export let toolchainComponents = async (
		arg?: ToolchainEnvArg,
	): Promise<ToolchainComponents> => {
		let {
			env,
			forcePrefix = false,
			host: host_,
			target: targetTriple,
		} = arg ?? {};

		if (env === undefined) {
			throw new Error("No environment provided.");
		}

		// Make sure we have a toolchain.
		await sdk.assertProvidesToolchain({
			env,
			forcePrefix,
			host: host_,
			target: targetTriple,
		});

		let host = await determineToolchainHost({
			env,
			host: host_,
			target: targetTriple,
		});
		let os = std.triple.os(host);
		let target = targetTriple ?? host;
		let detectedHost = await std.triple.host();
		let host__ = host_ ?? detectedHost;
		let standardizedHost = std.sdk.canonicalTriple(host__);
		let isCross =
			std.triple.arch(standardizedHost) !== std.triple.arch(target) ||
			std.triple.os(standardizedHost) !== std.triple.os(target) ||
			std.triple.environment(standardizedHost) !==
				std.triple.environment(target);
		let targetPrefix = forcePrefix || isCross ? `${target}-` : ``;

		// Set the default flavor for the os at first, to confirm later.
		let flavor: "gnu" | "llvm" = os === "linux" ? "gnu" : "llvm";

		// Determine actual flavor and locate cc and c++.
		let cc;
		let cxx;
		let fortran;
		if (flavor === "gnu") {
			// Check if `gcc` is available.
			let gcc = await std.env.tryWhich({ env, name: `${targetPrefix}gcc` });
			if (gcc) {
				// If so, try to find `g++`.
				let gxx = await std.env.tryWhich({ env, name: `${targetPrefix}g++` });
				tg.assert(gxx, `Found ${targetPrefix}gcc but not ${targetPrefix}g++.`);
				let gfortran = await std.env.tryWhich({
					env,
					name: `${targetPrefix}gfortran`,
				});
				fortran = gfortran;
				cc = gcc;
				cxx = gxx;
			} else {
				// Try to find clang, which needs no prefix.
				let clang = await std.env.tryWhich({ env, name: "clang" });
				tg.assert(clang, `Found neither ${targetPrefix}gcc nor clang.`);
				// If clang is available, try to find clang++.
				let clangxx = await std.env.tryWhich({ env, name: "clang++" });
				tg.assert(clangxx, "Found clang but not clang++.");
				flavor = "llvm";
				cc = clang;
				cxx = clangxx;
			}
		} else {
			// Check if `clang` is available.
			let clang = await std.env.tryWhich({ env, name: "clang" });
			if (clang) {
				// If so, try to find `clang++`.
				let clangxx = await std.env.tryWhich({ env, name: "clang++" });
				tg.assert(clangxx, "Found clang but not clang++.");
				cc = clang;
				cxx = clangxx;
			} else {
				// Try to find gcc.
				let gcc = await std.env.tryWhich({ env, name: `${targetPrefix}gcc` });
				tg.assert(gcc, `Found neither clang nor ${targetPrefix}gcc.`);
				// If gcc is available, try to find g++.
				let gxx = await std.env.tryWhich({ env, name: `${targetPrefix}g++` });
				tg.assert(gxx, `Found ${targetPrefix}gcc but not ${targetPrefix}g++.`);
				let gfortran = await std.env.tryWhich({
					env,
					name: `${targetPrefix}gfortran`,
				});
				flavor = "gnu";
				cc = gcc;
				cxx = gxx;
				fortran = gfortran;
			}
		}

		let compiler = flavor === "gnu" ? `${targetPrefix}gcc` : "clang";
		let cxxCompiler = flavor === "gnu" ? `${targetPrefix}g++` : `clang++`;
		let directory = await std.env.whichArtifact({ name: compiler, env });

		tg.assert(directory, "Unable to find toolchain directory.");
		cc = await tg.symlink(tg`${directory}/bin/${compiler}`);
		cxx = await tg.symlink(tg`${directory}/bin/${cxxCompiler}`);
		if (fortran) {
			fortran = await tg.symlink(tg`${directory}/bin/${targetPrefix}gfortran`);
		}

		// Grab the linker from the same directory as the compiler, not just by using `Env.which`.
		let linkerName =
			os === "darwin"
				? isCross
					? `${targetPrefix}ld.bfd`
					: "ld"
				: flavor === "gnu"
				  ? `${targetPrefix}ld`
				  : "ld.lld";
		let foundLd = await directory.tryGet(`bin/${linkerName}`);
		let ld;
		if (foundLd) {
			ld = await tg.symlink(tg`${directory}/bin/${linkerName}`);
		} else {
			// If we couldn't find the linker, try to find it in the PATH.
			let ldDir = await std.env.whichArtifact({ env, name: linkerName });
			if (ldDir) {
				ld = await tg.symlink(tg`${ldDir}/bin/${linkerName}`);
			}
		}
		tg.assert(ld, `could not find ${linkerName}`);

		// Locate the dynamic interpreter.
		let ldso;
		let libDir;
		if (os !== "darwin") {
			if (forcePrefix || isCross) {
				if (std.triple.os(target) === "darwin") {
					// If the target is darwin, there is an LDSO in an unprefixed lib dir, but we do not need it
					libDir = tg.Directory.expect(await directory.tryGet("lib"));
					ldso = undefined;
				} else {
					libDir = tg.Directory.expect(await directory.tryGet(`${target}/lib`));
					let ldsoPath = libc.interpreterName(target);
					ldso = tg.File.expect(await libDir.tryGet(ldsoPath));
				}
			} else {
				// Go through LIBRARY_PATH to find the dynamic linker.
				let ldsoPath = libc.interpreterName(host);
				for await (let [_parent, dir] of std.env.dirsInVar({
					env,
					key: "LIBRARY_PATH",
				})) {
					let foundLdso = await dir.tryGet(ldsoPath);
					if (foundLdso) {
						ldso = tg.File.expect(foundLdso);
						libDir = dir;
						break;
					}
				}
			}
		} else {
			if (isCross) {
				let sysroot = tg.Directory.expect(
					await directory.tryGet(`${target}/sysroot`),
				);
				libDir = tg.Directory.expect(await sysroot.tryGet(`lib`));
				if (std.triple.environment(target) === "gnu") {
					let ldsoPath = libc.interpreterName(target);
					ldso = tg.File.expect(await sysroot.tryGet(`lib/${ldsoPath}`));
				} else {
					ldso = tg.File.expect(await sysroot.tryGet(`usr/lib/libc.so`));
				}
			} else {
				libDir = tg.Directory.expect(await directory.tryGet("lib"));
			}
		}
		tg.assert(libDir, "could not find lib directory");

		// Locate the strip utility.
		let strip = await std.env.which({ env, name: `${targetPrefix}strip` });

		return {
			cc,
			cxx,
			fortran,
			directory,
			flavor,
			host,
			ld,
			ldso,
			libDir,
			strip,
			target,
		};
	};

	type ToolchainEnvArg = {
		/** The environment to ascertain the host from. */
		env?: std.env.Arg | undefined;
		/** Should we force the use of a target-triple prefix, regardless of host? Default: false */
		forcePrefix?: boolean | undefined;
		/** What machine is the compiler expecting to run on? */
		host?: string | undefined;
		/** If the environment is a cross-compiler, what target should we use to look for prefixes? */
		target?: string | undefined;
	};

	export type ToolchainComponents = {
		cc: tg.Symlink;
		cxx: tg.Symlink;
		fortran?: tg.Symlink | undefined;
		directory: tg.Directory;
		flavor: "gnu" | "llvm";
		host: string;
		ld: tg.Symlink;
		ldso?: tg.File | undefined; // NOTE - not present on macOS.
		libDir: tg.Directory;
		strip: tg.File | tg.Symlink;
		target: string;
	};

	/** Determine whether an SDK supports compiling for a specific target. */
	export let supportsTarget = async (
		arg: ToolchainEnvArg,
	): Promise<boolean> => {
		let detectedHost = await std.triple.host();
		let target = arg.target ?? detectedHost;
		if (
			std.triple.os(detectedHost) === "darwin" &&
			std.triple.os(target) === "darwin"
		) {
			return true;
		}

		let allTargets = await supportedTargets(arg.env);
		return allTargets.some((t) => t === target);
	};

	/** Obtain the host system for the compilers provided by this env. Throws an error if no compiler is found. */
	export let determineToolchainHost = async (
		arg: ToolchainEnvArg,
	): Promise<string> => {
		let { env, host: host_, target: target_ } = arg;
		let detectedHost = host_ ?? (await std.triple.host());
		let target = target_ ?? detectedHost;
		let isCross = detectedHost !== target;

		if (std.triple.os(detectedHost) === "darwin") {
			return detectedHost;
		}

		// Locate the C compiler using the CC variable if set, falling back to "cc" in PATH if not.
		let targetString = isCross ? target : "";
		let ccEnvVar = isCross ? `CC_${targetString.replace(/-/g, "_")}` : "CC";
		let cmd = `$${ccEnvVar}`;
		let foundCC = await std.env.tryGetArtifactByKey({ env, key: ccEnvVar });
		let targetPrefix = isCross ? `${targetString}-` : "";
		if (!foundCC) {
			let clang = await std.env.tryWhich({ env, name: "clang" });
			if (clang) {
				cmd = "clang";
				foundCC = clang as tg.File | tg.Symlink;
			} else {
				let name = `${targetPrefix}cc`;
				foundCC = await std.env.tryWhich({ env, name });
				cmd = name;
			}
		}

		// If we couldn't locate a file or symlink at either CC or `cc` in $PATH, we can't determine the host.
		if (
			!foundCC ||
			!(foundCC instanceof tg.File || foundCC instanceof tg.Symlink)
		) {
			throw new Error(
				`Could not find a valid file or symlink via CC or looking up ${targetPrefix}cc in PATH`,
			);
		}

		if (foundCC instanceof tg.File) {
			// Inspect the file to see which system it should run on.
			let metadata = await std.file.executableMetadata(foundCC);
			if (metadata.format !== "elf" && metadata.format !== "mach-o") {
				throw new Error(`Unexpected compiler format ${metadata.format}.`);
			}
			let detectedArch: string | undefined;
			if (metadata.format === "elf") {
				detectedArch = metadata.arch;
			} else if (metadata.format === "mach-o") {
				detectedArch = metadata.arches[0] ?? "aarch64";
			}
			let os = metadata.format === "elf" ? "linux" : "darwin";
			let arch = detectedArch ?? "x86_64";
			detectedHost = `${arch}-${os}`;
		}

		// Actually run the compiler on the detected system to ask what host triple it's configured for.
		let output = tg.File.expect(
			await (
				await tg.target(tg`${cmd} -dumpmachine > $OUTPUT`, {
					env: std.env.arg(env),
					host: std.triple.archAndOs(detectedHost),
				})
			).output(),
		);
		let host = (await output.text()).trim();
		std.triple.assert(host);
		return host;
	};

	/** Retreive the full range of targets an SDK supports. */
	export let supportedTargets = async (
		sdk: std.env.Arg,
	): Promise<Array<string>> => {
		// Collect all available `*cc` binaries.
		let foundTargets: Set<string> = new Set();

		for await (let [name, _] of std.env.binsInPath({
			env: sdk,
			predicate: (name) => name.endsWith("-cc"),
		})) {
			let triple = name.slice(0, -3);
			foundTargets.add(triple);
		}

		return Array.from(foundTargets);
	};

	export let resolveHostAndTarget = async (
		arg?: HostAndTargetsOptions,
	): Promise<HostAndTargets> => {
		let host = arg?.host ?? (await std.triple.host());
		let targets = [];
		if (arg?.target) {
			targets.push(arg.target);
		}
		if (arg?.targets) {
			targets = targets.concat(arg.targets);
		}
		// If empty, set to host.
		if (targets.length === 0) {
			targets.push(host);
		}
		return { host, targets };
	};

	type ProxyTestArg = {
		// Only the lld and mold linkers leave comments in the binary we can search for.
		linkerFlavor?: "LLD" | "mold" | undefined;
		parameters: ProxyTestParameters;
		proxiedLinker?: boolean;
		sdkEnv: std.env.Arg;
		host?: string;
		target?: string;
	};

	/** Compile a program and assert a correct wrapper for the target was produced. If `host == target`, ensure the wrapper execute and produces the expected output. */
	export let assertCompiler = async (arg: ProxyTestArg) => {
		let proxiedLinker = arg.proxiedLinker ?? false;
		let linkerFlavor = arg.linkerFlavor;
		// Determine requested host and target.
		let expected = await resolveHostAndTarget({
			host: arg.host,
			target: arg.target,
		});
		let expectedHost = expected.host;
		// There will be exactly one.
		tg.assert(expected.targets.length === 1);
		let expectedTarget = expected.targets[0];
		tg.assert(expectedTarget);

		// Determine compiler target prefix, if any.
		let isCross = expectedHost !== expectedTarget;
		let targetPrefix = isCross ? `${expectedTarget}-` : ``;

		// Set up test parameters.
		let { lang, testProgram, expectedOutput } = arg.parameters;
		let cmd;
		if (lang === "c") {
			cmd = `${targetPrefix}cc`;
		} else if (lang === "c++") {
			cmd = `${targetPrefix}c++`;
		} else if (lang === "fortran") {
			cmd = `${targetPrefix}gfortran`;
		} else {
			throw new Error(`Unexpected language ${lang}.`);
		}
		tg.assert(cmd);

		// Compile the test source using the expected host system.
		let langStr: string = lang;
		if (lang === "fortran") {
			langStr = "f95";
		}
		let compiledProgram = tg.File.expect(
			await (
				await tg.target(
					tg`echo "testing ${lang}"
				set -x
				${cmd} -v -x${langStr} ${testProgram} -o $OUTPUT`,
					{
						env: std.env.arg(arg.sdkEnv),
						host: std.triple.archAndOs(expectedHost),
					},
				)
			).output(),
		);

		// Assert the resulting program was compiled for the expected target.
		let expectedArch = std.triple.arch(expectedTarget);
		let metadata = await std.file.executableMetadata(compiledProgram);
		if (metadata.format === "elf") {
			let actualArch = metadata.arch;
			tg.assert(expectedArch === actualArch);

			// Ensure the correct libc was used.
			let executable = compiledProgram;
			if (proxiedLinker) {
				executable = tg.File.expect(await std.wrap.unwrap(compiledProgram));
				metadata = await std.file.executableMetadata(executable);
			}
			if (linkerFlavor) {
				await assertComment(executable, arg.sdkEnv, linkerFlavor);
			}

			tg.assert(metadata.format === "elf");
			let expectedInterpreter = libc.interpreterName(expectedTarget);
			let actualInterpreter = metadata.interpreter;
			tg.assert(actualInterpreter, "File should have been dynamically linked.");
			tg.assert(
				actualInterpreter.includes(expectedInterpreter),
				`Expected interpreter named ${expectedInterpreter} but got ${actualInterpreter}.`,
			);
		} else if (metadata.format === "mach-o") {
			tg.assert(metadata.arches.includes(expectedArch as string));
		} else {
			throw new Error(`Unexpected executable format ${metadata.format}.`);
		}

		// Assert the result contains a Tangram manifest, meaning it got automatically wrapped.
		tg.assert(std.wrap.Manifest.read(compiledProgram));

		// If we are not cross-compiling, assert we can execute the program and recieve the expected result, without providing the SDK env at runtime.
		if (!isCross && proxiedLinker) {
			let testOutput = tg.File.expect(
				await (
					await tg.target(tg`${compiledProgram} > $OUTPUT`, {
						host: std.triple.archAndOs(expectedHost),
						env: { TANGRAM_WRAPPER_TRACING: "tangram=trace" },
					})
				).output(),
			);
			let outputText = (await testOutput.text()).trim();
			tg.assert(outputText === expectedOutput);
		}
		return true;
	};

	/** Assert the given env provides everything it should for a particuar arg. */
	export let assertValid = async (env: std.env.Arg, arg: sdk.Arg) => {
		let expected = await resolveHostAndTarget(arg);

		// Check that the env provides a host toolchain.
		await sdk.assertProvidesToolchain({ env });

		// Assert we can determine a host and it matches the expected.
		let actualHost = await sdk.determineToolchainHost({ env });
		let actualHostArch = std.triple.arch(actualHost);
		let expectedHostArch = std.triple.arch(expected.host);
		let actualHostOs = std.triple.os(actualHost);
		let expectedHostOs = std.triple.os(expected.host);
		tg.assert(
			actualHostArch === expectedHostArch,
			`Given env provides an SDK with host arch ${actualHostArch} instead of expected ${expectedHostArch}.`,
		);
		tg.assert(
			actualHostOs === expectedHostOs,
			`Given env provides an SDK with host os ${actualHostOs} instead of expected ${expectedHostOs}.`,
		);
		let expectedHostEnvironment = std.triple.environment(expected.host);
		if (expectedHostEnvironment) {
			let actualHostEnvironment = std.triple.environment(actualHost);
			tg.assert(
				actualHostEnvironment === expectedHostEnvironment,
				`Given env provides an SDK with host environment ${actualHostEnvironment} instead of expected ${expectedHostEnvironment}.`,
			);
		}

		// Assert it can compile and wrap for all requested targets.
		let allTargets = await sdk.supportedTargets(env);
		// If there is an un-prefixed CC, add the host to the list.
		if (await std.env.tryWhich({ env, name: "cc" })) {
			allTargets.push(actualHost);
		}
		await Promise.all(
			expected.targets.map(async (target) => {
				// Make sure we found this target in the env.
				tg.assert(
					allTargets.some(
						(t) =>
							std.triple.arch(t) === std.triple.arch(target) &&
							std.triple.os(t) === std.triple.os(target),
					),
				);

				let proxiedLinker = false;
				if (arg?.proxy !== undefined) {
					if (typeof arg.proxy === "boolean") {
						proxiedLinker = arg.proxy;
					} else {
						proxiedLinker = arg.proxy.linker ?? false;
					}
				} else {
					proxiedLinker = true;
				}

				// The mold and LLD linkers leave comments in the binary. Check for these if applicable.
				let linkerFlavor = undefined;
				if (
					arg?.linker === "lld" ||
					(actualHostOs === "linux" &&
						arg?.toolchain === "llvm" &&
						arg?.linker === undefined)
				) {
					linkerFlavor = "LLD" as const;
				}
				if (arg?.linker === "mold") {
					linkerFlavor = "mold" as const;
				}

				// Test C.
				await assertCompiler({
					linkerFlavor,
					parameters: testCParameters,
					proxiedLinker,
					sdkEnv: env,
					host: expected.host,
					target,
				});
				if (proxiedLinker) {
					// Test C with linker proxy bypass.
					await assertCompiler({
						linkerFlavor,
						parameters: testCParameters,
						proxiedLinker: false,
						sdkEnv: await std.env.arg(env, {
							TANGRAM_LINKER_PASSTHROUGH: true,
						}),
						host: expected.host,
						target,
					});
				}

				// Test C++.
				await assertCompiler({
					linkerFlavor,
					parameters: testCxxParameters,
					proxiedLinker,
					sdkEnv: env,
					host: expected.host,
					target,
				});
				if (proxiedLinker) {
					// Test C++ with linker proxy bypass.
					await assertCompiler({
						linkerFlavor,
						parameters: testCxxParameters,
						proxiedLinker: false,
						sdkEnv: await std.env.arg(env, {
							TANGRAM_LINKER_PASSTHROUGH: true,
						}),
						host: expected.host,
						target,
					});
				}

				// Test Fortran.
				if (std.triple.os(target) !== "darwin" && arg?.toolchain !== "llvm") {
					await assertCompiler({
						linkerFlavor,
						parameters: testFortranParameters,
						proxiedLinker,
						sdkEnv: env,
						host: expected.host,
						target,
					});
					if (proxiedLinker) {
						// Test Fortran with linker proxy bypass.
						await assertCompiler({
							linkerFlavor,
							parameters: testFortranParameters,
							proxiedLinker: false,
							sdkEnv: await std.env.arg(env, {
								TANGRAM_LINKER_PASSTHROUGH: true,
							}),
							host: expected.host,
							target,
						});
					}
				}
			}),
		);
	};

	export let canonicalTriple = (triple: string): string => {
		let components = std.triple.components(std.triple.normalize(triple));
		if (components.os === "linux") {
			return std.triple.create({
				...components,
				environment: components.environment ?? "gnu",
			});
		} else if (components.os === "darwin") {
			return std.triple.create({
				...components,
				vendor: "apple",
			});
		} else {
			throw new Error(`Unsupported OS ${components.os}`);
		}
	};

	export type HostAndTargetsOptions = {
		host?: string | undefined;
		target?: string | undefined;
		targets?: Array<string> | undefined;
	};

	export type HostAndTargets = {
		host: string;
		targets: Array<string>;
	};

	export type LinkerKind = "bfd" | "lld" | "mold" | tg.Symlink | tg.File;

	export type ToolchainKind = "gnu" | "llvm" | std.env.Arg;
}

/** Check whether Tangram supports building a cross compiler from the host to the target. */
type ValidateCrossTargetArg = {
	host: string;
	target: string;
};

let validateCrossTarget = (arg: ValidateCrossTargetArg) => {
	let { host, target } = arg;

	// All triples can compile for themselves.
	if (host === target) {
		return true;
	}

	let hostOs = std.triple.os(host);
	let targetOs = std.triple.os(target);

	// Darwin supports cross-compiling.
	if (hostOs === "darwin") {
		return true;
	}

	// Linux supports cross compiling to other linux or darwin architectures.
	if (hostOs === "linux" && (targetOs === "linux" || targetOs === "darwin")) {
		return true;
	}

	// Otherwise, we don't support cross-compiling.
	return false;
};

/** Merge all lib and lib64 directories into a single lib directory, leaving a symlink. */
export let mergeLibDirs = async (dir: tg.Directory) => {
	for await (let [name, artifact] of dir) {
		// If we find a lib64, merge it with the adjacent lib.
		if (artifact instanceof tg.Directory) {
			if (name === "lib64") {
				let maybeLibDir = await dir.tryGet("lib");
				if (!maybeLibDir) {
					// There was no adjacent lib - this is best effort. Do nothing.
					continue;
				}
				// If we found it, deep merge the lib64 into it.
				let libDir = maybeLibDir;
				tg.assert(libDir instanceof tg.Directory);
				let mergedLibDir = await tg.directory(libDir, artifact);

				// Recurse into the merged lib directory.
				mergedLibDir = await mergeLibDirs(mergedLibDir);

				// Replace the original lib directory with the merged one, and add a symlink.
				dir = await tg.directory(dir, {
					lib: mergedLibDir,
					lib64: tg.symlink("lib"),
				});
			} else {
				// For all other directories, just recurse.
				let mergedSubdir = await mergeLibDirs(artifact);
				dir = await tg.directory(dir, {
					[name]: mergedSubdir,
				});
			}
		}
	}
	return dir;
};

/** Assert the given ELF file contains a comment that includes the provided string. */
export let assertComment = async (
	exe: tg.File,
	toolchain: std.env.Arg,
	textToMatch: string,
) => {
	let elfComment = tg.File.expect(
		await (
			await tg.target(
				tg`readelf -p .comment ${exe} | grep ${textToMatch} > $OUTPUT`,
				{
					env: await std.env.arg(toolchain, bootstrap.utils()),
				},
			)
		).output(),
	);
	let text = await elfComment.text();
	tg.assert(text.includes(textToMatch));
};

//////// TESTS

let testCParameters: ProxyTestParameters = {
	expectedOutput: "Hello, Tangram!",
	lang: "c",
	testProgram: tg.file(`
	#include <stdio.h>

	int main() {
		printf("Hello, Tangram!\\n");
		return 0;
	}
`),
};

let testCxxParameters: ProxyTestParameters = {
	expectedOutput: `new Tangram().send("Hello!")`,
	lang: "c++",
	testProgram: tg.file(`
	#include <iostream>

	int main() {
		std::cout << "new Tangram().send(\\"Hello!\\")" << std::endl;
		return 0;
	}
`),
};

let testFortranParameters: ProxyTestParameters = {
	expectedOutput: "Hello, Fortran!",
	lang: "fortran",
	testProgram: tg.file(`
	program hello
		print *, "Hello, Fortran!"
	end program hello
	`),
};

type ProxyTestParameters = {
	expectedOutput: string;
	lang: "c" | "c++" | "fortran";
	testProgram: tg.Unresolved<tg.File>;
};

export let testMoldSdk = tg.target(async () => {
	let detectedHost = await std.triple.host();
	if (std.triple.os(detectedHost) !== "linux") {
		throw new Error(`mold is only available on Linux`);
	}

	let sdkArg = { host: detectedHost, linker: "mold" as const };

	let moldSdk = await sdk(sdkArg);

	// Ensure that the SDK is valid.
	await sdk.assertValid(moldSdk, sdkArg);
	return moldSdk;
});

export let testGccLldSdk = tg.target(async () => {
	let detectedHost = await std.triple.host();
	if (std.triple.os(detectedHost) !== "linux") {
		throw new Error(`mold is only available on Linux`);
	}

	let sdkArg = { host: detectedHost, linker: "lld" as const };

	let lldSdk = await sdk(sdkArg);

	// Ensure that the SDK is valid.
	await sdk.assertValid(lldSdk, sdkArg);
	return lldSdk;
});

export let testMuslSdk = tg.target(async () => {
	let host = await std.triple.host();
	if (std.triple.os(host) !== "linux") {
		throw new Error(`musl is only available on Linux`);
	}
	let muslHost = std.triple.create(host, { environment: "musl" });
	let sdkArg = { host: muslHost };
	let env = await sdk(sdkArg);
	await sdk.assertValid(env, sdkArg);
	return env;
});

export let testCrossGccSdk = tg.target(async () => {
	let detectedHost = await std.triple.host();
	let detectedOs = std.triple.os(detectedHost);
	if (detectedOs === "darwin") {
		throw new Error(`Cross-compilation is not supported on Darwin`);
	}
	let detectedArch = std.triple.arch(detectedHost);
	let crossArch = detectedArch === "x86_64" ? "aarch64" : "x86_64";
	let crossTarget = sdk.canonicalTriple(
		std.triple.create(detectedHost, { arch: crossArch }),
	);
	let sdkArg = { host: detectedHost, target: crossTarget };
	let env = await sdk(sdkArg);
	await sdk.assertValid(env, sdkArg);
	return env;
});

export let testLLVMSdk = tg.target(async () => {
	let env = await sdk({ toolchain: "llvm" });
	await sdk.assertValid(env, { toolchain: "llvm" });
	return env;
});

export let testLLVMMoldSdk = tg.target(async () => {
	let detectedHost = await std.triple.host();
	if (std.triple.os(detectedHost) !== "linux") {
		throw new Error(`mold is only available on Linux`);
	}

	let sdkArg = {
		host: detectedHost,
		linker: "mold" as const,
		toolchain: "llvm" as const,
	};

	let moldSdk = await sdk(sdkArg);

	// Ensure that the SDK is valid.
	await sdk.assertValid(moldSdk, sdkArg);

	return moldSdk;
});

export let testLLVMBfdSdk = tg.target(async () => {
	let detectedHost = await std.triple.host();
	if (std.triple.os(detectedHost) !== "linux") {
		throw new Error(`bfd is only available on Linux`);
	}

	let sdkArg = {
		host: detectedHost,
		linker: "bfd" as const,
		toolchain: "llvm" as const,
	};

	let bfdSdk = await sdk(sdkArg);

	// Ensure that the SDK is valid.
	await sdk.assertValid(bfdSdk, sdkArg);
	return bfdSdk;
});

export let testExplicitGlibcVersionSdk = tg.target(async () => {
	let host = await std.triple.host();
	if (std.triple.os(host) !== "linux") {
		throw new Error(`glibc is only available on Linux`);
	}
	let oldGlibcHost = std.triple.create(host, {
		environment: "gnu",
		environmentVersion: "2.37",
	});
	let sdkArg = { host: oldGlibcHost };
	let env = await sdk(sdkArg);
	await sdk.assertValid(env, sdkArg);
	return env;
});

export let testLLVMMuslSdk = tg.target(async () => {
	let host = await std.triple.host();
	if (std.triple.os(host) !== "linux") {
		throw new Error(`musl is only available on Linux`);
	}
	let muslHost = std.triple.create(host, { environment: "musl" });
	let sdkArg = { host: muslHost, toolchain: "llvm" as const };
	let env = await sdk(sdkArg);
	await sdk.assertValid(env, sdkArg);
	return env;
});

export let testDarwinToLinux = tg.target(async () => {
	let targets = [
		"aarch64-unknown-linux-gnu",
		"aarch64-unknown-linux-musl",
		"x86_64-unknown-linux-gnu",
		"x86_64-unknown-linux-musl",
	];
	await Promise.all(
		targets.map(async (target) => await testDarwinToLinuxSingle(target)),
	);
	return true;
});

export let testDarwinToLinuxSingle = tg.target(async (target: string) => {
	let host = await std.triple.host();
	if (std.triple.os(host) !== "darwin") {
		throw new Error(`This test is only valid on Darwin`);
	}

	let sdkArg = { host, target };
	let env = await sdk(sdkArg);
	await sdk.assertValid(env, sdkArg);
	return env;
});

export let testLinuxToDarwin = tg.target(async () => {
	let host = await std.triple.host();
	if (std.triple.os(host) !== "linux") {
		throw new Error(`This test is only valid on Linux`);
	}

	let target = "aarch64-apple-darwin";
	let sdkArg = { host, target };
	let env = await sdk(sdkArg);
	await sdk.assertValid(env, sdkArg);
	return true;
});

export let testNativeProxiedSdks = async () => {
	await Promise.all(
		(await nativeProxiedSdkArgs()).map(async (arg) => {
			await sdk.assertValid(await sdk(arg), arg);
		}),
	);
	return true;
};

export let nativeProxiedSdkArgs = async (): Promise<Array<std.sdk.Arg>> => {
	let detectedHost = await std.triple.host();
	let detectedOs = std.triple.os(detectedHost);

	if (detectedOs === "darwin") {
		return [{}];
	}

	let hostGnu = sdk.canonicalTriple(detectedHost);

	return [{}, { toolchain: "llvm" }, { linker: "mold" }];
};

export let allSdkArgs = async (): Promise<Array<std.sdk.Arg>> => {
	let detectedHost = await std.triple.host();
	let detectedOs = std.triple.os(detectedHost);

	if (detectedOs === "darwin") {
		return [{}, { proxy: false }];
	}

	let hostGnu = sdk.canonicalTriple(detectedHost);
	let hostMusl = std.triple.create(hostGnu, { environment: "musl" });
	let detectedHostArch = std.triple.arch(detectedHost);
	let crossArch = detectedHostArch === "x86_64" ? "aarch64" : "x86_64";
	let crossGnu = std.triple.create(hostGnu, { arch: crossArch });
	let crossMusl = std.triple.create(crossGnu, { environment: "musl" });

	return [
		{},
		{ proxy: false },
		{ host: hostMusl },
		{ host: hostMusl, proxy: false },
		{ host: hostGnu, target: crossGnu },
		{ host: hostGnu, target: crossGnu, proxy: false },
		{ host: hostGnu, target: crossMusl },
		{ host: hostGnu, target: crossMusl, proxy: false },
		{ host: hostMusl, target: crossMusl },
		{ host: hostMusl, target: crossMusl, proxy: false },
		{ host: hostMusl, target: crossGnu },
		{ host: hostMusl, target: crossGnu, proxy: false },
		{ host: hostGnu, target: crossGnu, toolchain: "llvm" },
		{ host: hostGnu, target: crossGnu, toolchain: "llvm", proxy: false },
		{ linker: "mold" },
		{ linker: "mold", proxy: false },
		{ toolchain: "llvm" },
		{ toolchain: "llvm", proxy: false },
		{ toolchain: "llvm", linker: "mold" },
		{ toolchain: "llvm", linker: "mold", proxy: false },
		{ toolchain: "llvm", linker: "bfd" },
		{ toolchain: "llvm", linker: "bfd", proxy: false },
		{ toolchain: "gnu", linker: "lld" },
		{ toolchain: "gnu", linker: "lld", proxy: false },
		{ host: std.triple.create(detectedHost, { environmentVersion: "2.37" }) },
		{
			host: std.triple.create(detectedHost, { environmentVersion: "2.37" }),
			proxy: false,
		},
	];
};

export let assertAllSdks = async () => {
	await Promise.all(
		(await allSdkArgs()).map(async (arg) => {
			await sdk.assertValid(await sdk(arg), arg);
		}),
	);
	return true;
};
