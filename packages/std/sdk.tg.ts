/** This module provides environments ready to produce Tangram-wrapped executables from C and C++ code. */

import * as bootstrap from "./bootstrap.tg.ts";
import * as gcc from "./sdk/gcc.tg.ts";
import * as libc from "./sdk/libc.tg.ts";
import * as llvm from "./sdk/llvm.tg.ts";
import mold, { metadata as moldMetadata } from "./sdk/mold.tg.ts";
import * as proxy from "./sdk/proxy.tg.ts";
import * as std from "./tangram.tg.ts";

/** An SDK combines a compiler, a linker, a libc, and a set of basic utilities. */
export async function sdk(...args: tg.Args<sdk.Arg>): Promise<std.env.Arg> {
	type Apply = {
		bootstrapMode: Array<boolean>;
		proxyArg: Partial<proxy.Arg>;
		host: tg.Triple.Arg;
		targets: Array<tg.Triple.Arg>;
		toolchain: sdk.ToolchainKind;
		linker: sdk.LinkerKind;
	};
	let {
		bootstrapMode: bootstrapMode_,
		proxyArg: proxyArg_,
		host: host_,
		targets: targets_,
		toolchain: toolchain_,
		linker,
	} = await tg.Args.apply<sdk.Arg, Apply>(args, async (arg) => {
		if (arg === undefined) {
			return {};
		} else {
			let object: tg.MutationMap<Apply> = {};
			let targets: Array<tg.Triple.Arg> = [];
			if (arg.host !== undefined) {
				object.host = arg.host;
			}
			if (arg.proxy !== undefined) {
				let proxy;
				if (typeof arg.proxy === "boolean") {
					proxy = arg.proxy
						? { compiler: true, linker: true }
						: { compiler: false, linker: false };
				} else {
					proxy = arg.proxy;
				}
				object.proxyArg = proxy;
			}
			if (arg.toolchain !== undefined) {
				object.toolchain = arg.toolchain;
			}
			if (arg.linker !== undefined) {
				object.linker = arg.linker;
			}
			if (arg.bootstrapMode !== undefined) {
				object.bootstrapMode = tg.Mutation.is(arg.bootstrapMode)
					? arg.bootstrapMode
					: await tg.Mutation.arrayAppend(arg.bootstrapMode);
			}
			if (arg.target !== undefined) {
				if (tg.Mutation.is(arg.target)) {
					object.targets = arg.target;
				} else {
					targets.push(arg.target);
				}
			}
			if (arg.targets !== undefined) {
				if (tg.Mutation.is(arg.targets)) {
					object.targets = arg.targets;
				} else {
					targets = targets.concat(arg.targets ?? []);
				}
			}
			object.targets = await tg.Mutation.arrayAppend<tg.Triple.Arg>(targets);
			return object;
		}
	});
	let proxyArg = proxyArg_ ?? { compiler: false, linker: true };

	// If we're in bootstrap mode, stop here and return the bootstrap SDK.
	let bootstrapMode = (bootstrapMode_ ?? []).some((mode) => mode);
	let host = bootstrapMode
		? bootstrap.toolchainTriple(await tg.Triple.host())
		: normalizeTriple(host_ ? tg.triple(host_) : await tg.Triple.host());
	if (bootstrapMode) {
		let bootstrapSDK = bootstrap.sdk.env({ host });
		let proxyEnv = proxy.env({
			...proxyArg,
			bootstrapMode,
			buildToolchain: bootstrapSDK,
			host,
		});
		return std.env.object(bootstrapSDK, proxyEnv);
	}

	// Collect target array.
	let targets = (targets_ ?? []).map((t) => normalizeTriple(tg.triple(t)));
	if (targets.length === 0) {
		targets = [host];
	}

	if (linker && host.os === "darwin") {
		return tg.unimplemented(
			"Linker swapping is currently unsupported on macOS.",
		);
	}

	if (host.os === "darwin") {
		// Build the utils using the bootstrap SDK and add them to the env.
		let bootstrapSDK = await bootstrap.sdk.env({ host });
		let proxyEnv = await proxy.env({
			...proxyArg,
			buildToolchain: bootstrapSDK,
		});
		console.log("proxyEnv", proxyEnv);
		let utilsEnv = await std.utils.env({
			host,
			sdk: { bootstrapMode: true },
		});
		console.log("utilsEnv", utilsEnv);
		return std.env(bootstrapSDK, proxyEnv, utilsEnv, {
			bootstrapMode: true,
		});
	}

	let toolchain = toolchain_ ?? (host.vendor === "apple" ? "llvm" : "gcc");
	for (let target of targets) {
		if (!tg.Triple.eq(host, target)) {
			let hostString = tg.Triple.toString(host);
			let targetString = tg.Triple.toString(target);
			tg.assert(
				validateCrossTarget({ host, target }),
				`Cross-compiling from ${hostString} to ${targetString} is not supported.`,
			);
		}
	}

	// If a previous SDK was provided, use that as the base env, otherwise start with an empty list.
	let env: Array<tg.Unresolved<std.env.Arg>> = [];

	// If the toolchain is not a string, proxy it for the host.
	if (typeof toolchain !== "string") {
		let directory = toolchain;
		let allCrossTargets = await sdk.supportedTargets(directory);
		// For each requested target not already present in a provided SDK, add a proxy.
		let alreadyProxied: Array<tg.Triple> = [];
		let newTargets = allCrossTargets.filter(
			(target) =>
				!alreadyProxied.some((triple) => tg.Triple.eq(triple, target)),
		);

		// Ensure the directory provides a toolchain configured with the correct host.
		let checkTarget = newTargets.length > 0 ? newTargets[0] : host;
		let detectedHost = await sdk.getHost({
			env: directory,
			target: checkTarget,
		});
		let hostString = tg.Triple.toString(host);
		let detectedHostString = tg.Triple.toString(detectedHost);
		tg.assert(
			tg.Triple.eq(detectedHost, host),
			`Detected toolchain host ${detectedHostString} does not match requested host ${hostString}`,
		);
		env.push(directory);

		for await (let requestedTarget of targets) {
			if (
				alreadyProxied.some((triple) => tg.Triple.eq(triple, requestedTarget))
			) {
				continue;
			}
			if (
				!allCrossTargets.some((triple) => tg.Triple.eq(triple, requestedTarget))
			) {
				let targetString = tg.Triple.toString(requestedTarget);
				throw new Error(
					`Provided toolchain does not provide a ${hostString} -> ${targetString} toolchain.`,
				);
			}
			env.push(
				proxy.env({
					...proxyArg,
					buildToolchain: directory,
					build: host,
					host: requestedTarget,
				}),
			);
		}
		// Build the utils using the proxied host toolchain and add them to the env.
		env.push(std.utils.env({ env }));
		return std.env(...env, { bootstrapMode: true });
	} else if (toolchain === "gcc") {
		// Collect environments to compose.
		let envs: tg.Unresolved<Array<std.env.Arg>> = [];

		// Add the host toolchain.
		let hostToolchain = await gcc.toolchain({ host });
		envs.push(hostToolchain);

		let proxyEnv = await proxy.env({
			...proxyArg,
			buildToolchain: hostToolchain,
			build: host,
			host,
		});
		envs.push(proxyEnv);

		// Add remaining dependencies.
		let utilsEnv = await std.utils.env({
			build: host,
			host,
			env: envs,
			bootstrapMode: true,
		});
		envs.push(utilsEnv);

		// Add any requested cross-compilers, without packages.
		let crossEnvs = [];
		for await (let target of targets) {
			if (tg.Triple.eq(host, target)) {
				continue;
			}
			let crossToolchain = await gcc.toolchain({ host, target });
			crossEnvs.push(crossToolchain);
			let proxyEnv = await proxy.env({
				...proxyArg,
				buildToolchain: crossToolchain,
				build: host,
				host: target,
			});
			crossEnvs.push(proxyEnv);
		}

		// Combine envs, preventing the utils from recompiling.
		let defaultSdk = await std.env(...envs, ...crossEnvs, {
			bootstrapMode: true,
		});
		if (linker) {
			// If an alternate linker was requested, use the default env to build a new proxy env with the alternate linker.
			let linkerDir: tg.Directory | undefined = undefined;
			let linkerExe: tg.File | tg.Symlink | undefined = undefined;
			if (tg.Symlink.is(linker) || tg.File.is(linker)) {
				linkerExe = linker;
			} else {
				switch (linker) {
					case "lld": {
						return tg.unimplemented("lld support is not yet implemented.");
					}
					case "mold": {
						let moldArtifact = await mold({ host });
						linkerDir = moldArtifact;
						linkerExe = tg.File.expect(await moldArtifact.get("bin/mold"));
						break;
					}
					case "bfd": {
						// The default SDK is already correct.
						return defaultSdk;
					}
				}
			}
			let proxyEnv = await proxy.env({
				...proxyArg,
				buildToolchain: hostToolchain,
				build: host,
				host,
				linkerExe,
			});
			let alternateLinkerEnvs = [
				hostToolchain,
				proxyEnv,
				utilsEnv,
				...crossEnvs,
			];
			if (tg.Directory.is(linkerDir)) {
				alternateLinkerEnvs.push(linkerDir);
			}
			return std.env(...alternateLinkerEnvs, {
				bootstrapMode: true,
			});
		} else {
			return defaultSdk;
		}
	} else if (toolchain === "llvm") {
		let clangToolchain = await llvm.toolchain({ host });
		let proxyEnv = await proxy.env({
			...proxyArg,
			buildToolchain: clangToolchain,
			build: host,
			host,
			llvm: true,
		});
		let clangEnv = {
			CC: "clang",
			CXX: "clang++",
		};
		let utilsEnv = await std.utils.env({
			env: [clangToolchain, proxyEnv, clangEnv],
			build: host,
			host,
			bootstrapMode: true,
		});
		return std.env(clangToolchain, proxyEnv, utilsEnv, clangEnv, {
			bootstrapMode: true,
		});
	}

	throw new Error(`Invalid SDK arg ${args}.`);
}

export namespace sdk {
	export type Arg = ArgObject | undefined;

	export type ArgObject = {
		/** Provide an env consisting only of bootstrap components and a linker proxy. Will not build additional utils or bootstrap GCC. */
		bootstrapMode?: boolean;
		/** The machine this SDK will compile on. */
		host?: tg.Triple.Arg;
		/** An alternate linker to use. */
		linker?: LinkerKind;
		/** Which components should get proxied. Use `true` or `false` as a shorthand for enabling or disabling all proxies. If not provided, the default behavior is to proxy the linker but not the compiler. */
		proxy?: Partial<proxy.Arg> | boolean;
		/** The machine this SDK produces executables for. */
		target?: tg.Triple.Arg;
		/** A list of machines this SDK can produce executables for. */
		targets?: Array<tg.Triple.Arg>;
		/** Env containing the compiler. If not provided, will default to a native GCC toolchain. */
		toolchain?: ToolchainKind;
	};

	export type BuildEnvArg = {
		bootstrapMode?: boolean;
		build?: tg.Triple.Arg;
		debug?: boolean;
		env?: std.env.Arg;
		host?: tg.Triple.Arg;
		sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	};

	///////// QUERIES

	type ProvidesToolchainArg = {
		bootstrapMode?: boolean;
		env: std.env.Arg;
		llvm?: boolean;
		host?: tg.Triple.Arg;
		target?: tg.Triple.Arg;
	};

	let requiredCompilerComponents = ["c++", "cc", "ld"] as const;
	let requiredLLVMCompilerComponents = ["clang++", "clang", "ld.lld"];

	let requiredUtils = ["ar", "as", "nm", "objdump", "ranlib", "strip"] as const;

	/** Assert that an env provides an toolchain. */
	export let assertProvidesToolchain = async (arg: ProvidesToolchainArg) => {
		let {
			bootstrapMode,
			env,
			host: host_,
			llvm = false,
			target: target_,
		} = arg;
		let host = host_ ? tg.triple(host_) : await tg.Triple.host();
		let target = target_ ? tg.triple(target_) : host;
		let isCross = !tg.Triple.eq(host, target);
		// Provides binutils, cc/c++.
		let targetPrefix = ``;
		if (isCross && !bootstrapMode) {
			let os = tg.triple(target).os;
			if (os !== "darwin") {
				targetPrefix = `${tg.Triple.toString(target)}-`;
			}
		}
		let llvmPrefix = llvm ? "llvm-" : "";
		await std.env.assertProvides({
			env,
			names: requiredUtils.map((name) => `${targetPrefix}${llvmPrefix}${name}`),
		});
		if (llvm) {
			await std.env.assertProvides({
				env,
				names: requiredLLVMCompilerComponents,
			});
		} else {
			await std.env.assertProvides({
				env,
				names: requiredCompilerComponents.map(
					(name) => `${targetPrefix}${name}`,
				),
			});
		}
		return true;
	};

	/** Determine whether an env provides an toolchain. */
	export let providesToolchain = (
		arg: ProvidesToolchainArg,
	): Promise<boolean> => {
		let { env, target } = arg;
		let targetPrefix = ``;
		if (target) {
			let os = tg.triple(target).os;
			if (os !== "darwin") {
				targetPrefix = `${tg.Triple.toString(tg.triple(target))}-`;
			}
		}
		if (arg.llvm) {
			return std.env.provides({
				env,
				names: requiredLLVMCompilerComponents,
			});
		} else {
			return std.env.provides({
				env,
				names: requiredCompilerComponents.map(
					(name) => `${targetPrefix}${name}`,
				),
			});
		}
	};

	/** Locate the C and C++ compilers, linker, and ld.so from a toolchain. */
	export let toolchainComponents = async (
		arg?: ToolchainEnvArg,
	): Promise<ToolchainComponents> => {
		let {
			bootstrapMode,
			env,
			host: host_,
			llvm = false,
			target: targetTriple,
		} = arg ?? {};
		// Make sure we have a toolchain.
		await sdk.assertProvidesToolchain({
			bootstrapMode,
			env,
			host: host_,
			llvm,
			target: targetTriple,
		});
		let host = await getHost({ env, host: host_, llvm });
		let os = host.os;
		let target = targetTriple ? tg.triple(targetTriple) : host;
		let isCross = !tg.Triple.eq(host, target);
		let targetString = tg.Triple.toString(target);
		let targetPrefix = isCross && !bootstrapMode ? `${targetString}-` : ``;

		// Set the default flavor for the os at first, to confirm later.
		let flavor: "gcc" | "llvm" = os === "linux" ? "gcc" : "llvm";

		// Determine actual flavor and locate cc and c++.
		let cc;
		let cxx;
		let fortran;
		if (flavor === "gcc") {
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
				flavor = "gcc";
				cc = gcc;
				cxx = gxx;
				fortran = gfortran;
			}
		}

		let compiler = flavor === "gcc" ? `${targetPrefix}${flavor}` : "clang";
		let cxxCompiler = flavor === "gcc" ? `${targetPrefix}g++` : `clang++`;
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
				? "ld"
				: flavor === "gcc"
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
				ld = await tg.symlink(tg`${ldDir}/ld`);
			}
		}
		tg.assert(ld, `could not find ${linkerName}`);

		// Locate the dynamic interpreter.
		let ldso;
		let libDir;
		if (os !== "darwin") {
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
		} else {
			libDir = tg.Directory.expect(await directory.tryGet("lib"));
		}
		tg.assert(libDir, "could not find lib directory");

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
			target,
		};
	};

	type ToolchainEnvArg = {
		/** Relax checks, assuming the bootstrap components are present. */
		bootstrapMode?: boolean;
		/** The environment to ascertain the host from. */
		env?: std.env.Arg;
		host?: tg.Triple.Arg;
		llvm?: boolean;
		/** If the environment is a cross-compiler, what target should we use to look for prefixes? */
		target?: tg.Triple.Arg;
	};

	export type ToolchainComponents = {
		cc: tg.Symlink;
		cxx: tg.Symlink;
		fortran?: tg.Symlink;
		directory: tg.Directory;
		flavor: "gcc" | "llvm";
		host: tg.Triple;
		ld: tg.Symlink;
		ldso?: tg.File; // NOTE - not present on macOS.
		libDir: tg.Directory;
		target: tg.Triple;
	};

	/** Determine whether an SDK supports compiling for a specific target. */
	export let supportsTarget = async (
		arg: ToolchainEnvArg,
	): Promise<boolean> => {
		let target = arg.target ? tg.triple(arg.target) : await tg.Triple.host();
		if ((await tg.Triple.host()).os === "darwin" && target.os === "darwin") {
			return true;
		}

		let allTargets = await supportedTargets(arg.env);
		return allTargets.some((t) => tg.Triple.eq(t, target));
	};

	/** Retreive the full range of targets an SDK supports. */
	export let supportedTargets = async (
		sdk: std.env.Arg,
	): Promise<Array<tg.Triple>> => {
		// Collect all available `*cc` binaries.
		let foundTargets: Set<tg.Triple> = new Set();

		for await (let [name, _] of std.env.binsInPath({
			env: sdk,
			predicate: (name) => name.endsWith("-cc"),
		})) {
			let tripleString = name.slice(0, -3);
			foundTargets.add(tg.triple(tripleString));
		}
		return Array.from(foundTargets);
	};

	/** Obtain the host system for the compilers provided by this env. Throws an error if no compiler is found. */
	export let getHost = async (arg: ToolchainEnvArg): Promise<tg.Triple> => {
		let { env, host: host_, target } = arg;
		let detectedHost = host_ ? tg.triple(host_) : await tg.Triple.host();

		if (detectedHost.os === "darwin") {
			return detectedHost;
		}

		// Locate the C compiler using the CC variable if set, falling back to "cc" in PATH if not.
		let targetString = target ? tg.Triple.toString(tg.triple(target)) : "";
		let ccEnvVar = target ? `CC_${targetString.replace(/-/g, "_")}` : "CC";
		let cmd = `$${ccEnvVar}`;
		let foundCC = await std.env.tryGetArtifactByKey({ env, key: ccEnvVar });
		let targetPrefix = target ? `${targetString}-` : "";
		if (!foundCC) {
			let name = arg?.llvm ? "clang" : `${targetPrefix}cc`;
			foundCC = await std.env.tryWhich({ env, name });
			cmd = name;
		}

		// If we couldn't locate a file or symlink at either CC or `cc` in $PATH, we can't determine the host.
		if (!foundCC || !(tg.File.is(foundCC) || tg.Symlink.is(foundCC))) {
			throw new Error(
				`Could not find a valid file or symlink via CC or looking up ${targetPrefix}cc in PATH`,
			);
		}

		if (tg.File.is(foundCC)) {
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
			let os: tg.Triple.Os = metadata.format === "elf" ? "linux" : "darwin";
			detectedHost = tg.triple({ arch: detectedArch ?? "x86_64", os });
		}

		// Actually run the compiler on the detected system to ask what host triple it's configured for.
		let output = tg.File.expect(
			await tg.build(tg`${cmd} -dumpmachine > $OUTPUT`, {
				env: std.env.object(env),
				host: tg.Triple.archAndOs(detectedHost),
			}),
		);
		let host = (await output.text()).trim();
		return tg.triple(host);
	};

	export let resolveHostAndTarget = async (
		arg?: HostAndTargetsOptions,
	): Promise<HostAndTargets> => {
		let host = arg?.host ? tg.triple(arg.host) : await tg.Triple.host();
		let targets = [];
		if (arg?.target) {
			targets.push(tg.triple(arg.target));
		}
		if (arg?.targets) {
			targets = targets.concat(arg.targets.map((t) => tg.triple(t)));
		}
		// If empty, set to host.
		if (targets.length === 0) {
			targets.push(host);
		}
		return { host, targets };
	};

	/** Compile a program and assert a correct wrapper for the target was produced. If `host == target`, ensure the wrapper execute and produces the expected output. */
	export let assertProxiedCompiler = async (arg: ProxyTestArg) => {
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
		let isCross = !tg.Triple.eq(expectedHost, expectedTarget);
		let targetPrefix = isCross ? `${tg.Triple.toString(expectedTarget)}-` : ``;

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
			await tg.build(
				tg`echo "testing ${lang}"
				set -x
				${cmd} -v -x${langStr} ${testProgram} -o $OUTPUT`,
				{
					env: std.env.object(arg.sdk),
					host: tg.Triple.archAndOs(expectedHost),
				},
			),
		);

		// Assert the resulting program was compiled for the expected target.
		let expectedArch = expectedTarget.arch;
		let metadata = await std.file.executableMetadata(compiledProgram);
		if (metadata.format === "elf") {
			let actualArch = metadata.arch;
			tg.assert(expectedArch === actualArch);

			// Ensure the correct libc was used.
			let unwrappedExe = tg.File.expect(await std.wrap.unwrap(compiledProgram));
			let unwrappedMetadata = await std.file.executableMetadata(unwrappedExe);
			tg.assert(unwrappedMetadata.format === "elf");
			let expectedInterpreter = libc.interpreterName(expectedHost);
			let actualInterpreter = unwrappedMetadata.interpreter;
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
		if (!isCross) {
			let testOutput = tg.File.expect(
				await tg.build(tg`${compiledProgram} > $OUTPUT`, {
					host: tg.Triple.archAndOs(expectedHost),
					env: { TANGRAM_WRAPPER_TRACING: "tangram=trace" },
				}),
			);
			let outputText = (await testOutput.text()).trim();
			tg.assert(outputText === expectedOutput);
		}
		return true;
	};

	/** Assert the given env provides everything it should for a particuar arg. */
	export let assertValid = async (env: std.env.Arg, arg?: sdk.Arg) => {
		let expected = await resolveHostAndTarget(arg);

		// Check that the env provides a host toolchain.
		await sdk.assertProvidesToolchain({ env, llvm: arg?.toolchain === "llvm" });

		// Assert we can determine a host and it matches the expected.
		let actualHost = await sdk.getHost({ env });
		let actualHostArch = tg.Triple.arch(actualHost);
		let expectedHostArch = tg.Triple.arch(expected.host);
		let actualHostOs = tg.Triple.os(actualHost);
		let expectedHostOs = tg.Triple.os(expected.host);
		tg.assert(
			actualHostArch === expectedHostArch,
			`Given env provides an SDK with host arch ${actualHostArch} instead of expected ${expectedHostArch}.`,
		);
		tg.assert(
			actualHostOs === expectedHostOs,
			`Given env provides an SDK with host os ${actualHostOs} instead of expected ${expectedHostOs}.`,
		);
		if (expected.host.environment) {
			let actualHostEnvironment = tg.Triple.environment(actualHost);
			tg.assert(
				actualHostEnvironment === expected.host.environment,
				`Given env provides an SDK with host environment ${actualHostEnvironment} instead of expected ${expected.host.environment}.`,
			);
		}

		// Assert it provides utilities.
		if (arg?.bootstrapMode) {
			// Just test for the "dash" shell and "ls", indicating there is a busybox or comparable alternative.
			await std.env.assertProvides({ env, names: ["dash", "ls"] });
		} else {
			// Test for the complete set.
			await std.utils.assertProvides(env);
		}

		// Assert it can compile and wrap for all requested targets.
		let allTargets =
			actualHost.os === "linux" && arg?.toolchain !== "llvm"
				? await sdk.supportedTargets(env)
				: [actualHost];
		await Promise.all(
			expected.targets.map(async (target) => {
				// Make sure we found this target in the env.
				tg.assert(
					allTargets.some(
						(t) =>
							tg.Triple.arch(t) === tg.Triple.arch(target) &&
							tg.Triple.os(t) === tg.Triple.os(target),
					),
				);

				// Test C.
				await assertProxiedCompiler({
					parameters: testCParameters,
					sdk: env,
					host: expected.host,
					target,
				});

				// Test C++.
				await assertProxiedCompiler({
					parameters: testCxxParameters,
					sdk: env,
					host: expected.host,
					target,
				});

				// Test Fortran.
				if (target.os !== "darwin" && arg?.toolchain !== "llvm") {
					await assertProxiedCompiler({
						parameters: testFortranParameters,
						sdk: env,
						host: expected.host,
						target,
					});
				}
			}),
		);
	};

	export type HostAndTargetsOptions = {
		host?: tg.Triple.Arg;
		target?: tg.Triple.Arg;
		targets?: Array<tg.Triple.Arg>;
	};

	export type HostAndTargets = {
		host: tg.Triple;
		targets: Array<tg.Triple>;
	};

	export type LinkerKind = "bfd" | "lld" | "mold" | tg.Symlink | tg.File;

	export type ToolchainKind = "gcc" | "llvm" | std.env.Arg;
}

/** Check whether Tangram supports building a cross compiler from the host to the target. */
type ValidateCrossTargetArg = {
	host: tg.Triple;
	target: tg.Triple;
};

let validateCrossTarget = (arg: ValidateCrossTargetArg) => {
	let host = arg.host;
	let target = arg.target;

	// All triples can compile for themselves.
	if (tg.Triple.eq(host, target)) {
		return true;
	}

	// The default darwin toolchain supports cross-compiling to other darwin architectures.
	if (host.os === "darwin" && target.os === "darwin") {
		return true;
	}

	// Linux supports cross compiling to other linux architectures.
	if (host.os === "linux" && target.os === "linux") {
		return true;
	}

	// Otherwise, we don't support cross-compiling.
	return false;
};

/** Merge all lib and lib64 directories into a single lib directory, leaving a symlink. */
export let mergeLibDirs = async (dir: tg.Directory) => {
	for await (let [name, artifact] of dir) {
		// If we find a lib64, merge it with the adjacent lib.
		if (tg.Directory.is(artifact)) {
			if (name === "lib64") {
				let maybeLibDir = await dir.tryGet("lib");
				if (!maybeLibDir) {
					// There was no adjacent lib - this is best effort. Do nothing.
					continue;
				}
				// If we found it, deep merge the lib64 into it.
				let libDir = maybeLibDir;
				tg.assert(tg.Directory.is(libDir));
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

/** Produce the canonical version of the triple used by the toolchain. */
export let normalizeTriple = (triple: tg.Triple): tg.Triple => {
	let normalized = tg.Triple.normalized(triple);
	tg.assert(normalized, "Expected the detected host to normalize correctly");
	let base = tg.triple(normalized);
	if (base.os === "linux") {
		return tg.triple({
			arch: base.arch,
			vendor: base.vendor,
			os: base.os,
			environment: tg.Triple.environment(base) ?? "gnu",
		});
	} else if (base.os === "darwin") {
		return tg.triple({
			arch: base.arch,
			vendor: "apple",
			os: base.os,
		});
	} else {
		throw new Error(`Unsupported OS ${base.os}`);
	}
};

/** Resolve an optional host arg to a concrete host, falling back to the detected host if not present. */

//////// TESTS

let testCParameters: ProxyTestParameters = {
	expectedOutput: "Hello, Tangram!",
	lang: "c",
	testProgram: await tg.file(`
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
	testProgram: await tg.file(`
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
	testProgram: await tg.file(`
	program hello
		print *, "Hello, Fortran!"
	end program hello
	`),
};

type ProxyTestParameters = {
	expectedOutput: string;
	lang: "c" | "c++" | "fortran";
	testProgram: tg.File;
};

type ProxyTestArg = {
	parameters: ProxyTestParameters;
	sdk: std.env.Arg;
	host?: tg.Triple.Arg;
	target?: tg.Triple.Arg;
};

export let testMoldSdk = tg.target(async () => {
	let detectedHost = await tg.Triple.host();
	if (detectedHost.os !== "linux") {
		throw new Error(`mold is only available on Linux`);
	}

	let sdkArg = { host: detectedHost, linker: "mold" as const };

	let moldSdk = tg.File.expect(await sdk(sdkArg));

	// Ensure that the SDK is valid.
	await sdk.assertValid(moldSdk, sdkArg);

	// Ensure that produced artifacts contain the `mold` ELF comment.
	let source = tg.file(`
		#include <stdio.h>
		int main() {
			printf("Hello, world!\\n");
			return 0;
		}
	`);
	let output = tg.File.expect(
		await tg.build(tg`cc -v -xc ${source} -o $OUTPUT`, {
			env: await std.env.object(moldSdk),
		}),
	);
	let innerExe = tg.File.expect(await std.wrap.unwrap(output));
	let elfComment = tg.File.expect(
		await tg.build(tg`readelf -p .comment ${innerExe} | grep mold > $OUTPUT`, {
			env: await std.env.object(moldSdk),
		}),
	);
	let text = await elfComment.text();
	tg.assert(text.includes("mold"));
	tg.assert(text.includes(moldMetadata.version));

	return output;
});

export let testMuslSdk = tg.target(async () => {
	let host = await tg.Triple.host();
	if (host.os !== "linux") {
		throw new Error(`musl is only available on Linux`);
	}
	let muslHost = tg.triple({ ...host, environment: "musl" });
	let sdkArg = { host: muslHost };
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
	let detectedHost = await tg.Triple.host();
	if (detectedHost.os !== "linux") {
		throw new Error(`mold is only available on Linux`);
	}

	let sdkArg = {
		host: detectedHost,
		linker: "mold" as const,
		toolchain: "llvm" as const,
	};

	let moldSdk = tg.File.expect(await sdk(sdkArg));

	// Ensure that the SDK is valid.
	await sdk.assertValid(moldSdk, sdkArg);

	// Ensure that produced artifacts contain the `mold` ELF comment.
	let source = tg.file(`
		#include <stdio.h>
		int main() {
			printf("Hello, world!\\n");
			return 0;
		}
	`);
	let output = tg.File.expect(
		await tg.build(tg`cc -v -xc ${source} -o $OUTPUT`, {
			env: await std.env.object(moldSdk),
		}),
	);
	let innerExe = tg.File.expect(await std.wrap.unwrap(output));
	let elfComment = tg.File.expect(
		await tg.build(tg`readelf -p .comment ${innerExe} | grep mold > $OUTPUT`, {
			env: await std.env.object(moldSdk),
		}),
	);
	let text = await elfComment.text();
	tg.assert(text.includes("mold"));
	tg.assert(text.includes(moldMetadata.version));

	return output;
});

export let testExplicitGlibcVersionSdk = tg.target(async () => {
	let host = await tg.Triple.host();
	if (host.os !== "linux") {
		throw new Error(`glibc is only available on Linux`);
	}
	let oldGlibcHost = tg.triple(`${host.arch}-linux-gnu2.37`);
	let sdkArg = { host: oldGlibcHost };
	let env = await sdk(sdkArg);
	await sdk.assertValid(env, sdkArg);
	return env;
});

export let testLLVMMuslSdk = tg.target(async () => {
	let host = await tg.Triple.host();
	if (host.os !== "linux") {
		throw new Error(`musl is only available on Linux`);
	}
	let muslHost = tg.triple({ ...host, environment: "musl" });
	let sdkArg = { host: muslHost, toolchain: "llvm" as const };
	let env = await sdk(sdkArg);
	await sdk.assertValid(env, sdkArg);
	return env;
});
