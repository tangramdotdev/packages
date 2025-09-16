/** This module provides environments ready to produce Tangram-wrapped executables from C and C++ code. */

import * as bootstrap from "./bootstrap.tg.ts";
import binutils from "./sdk/gnu/binutils.tg.ts";
import * as gnu from "./sdk/gnu.tg.ts";
import * as libc from "./sdk/libc.tg.ts";
import * as llvm from "./sdk/llvm.tg.ts";
import mold from "./sdk/mold.tg.ts";
import * as proxy from "./sdk/proxy.tg.ts";
import * as std from "./tangram.ts";

export * as cmake from "./sdk/cmake.tg.ts";
export * as dependencies from "./sdk/dependencies.tg.ts";
export * as mold from "./sdk/mold.tg.ts";
export * as ninja from "./sdk/ninja.tg.ts";
export * as kernelHeaders from "./sdk/kernel_headers.tg.ts";
export * as gnu from "./sdk/gnu.tg.ts";
export * as llvm from "./sdk/llvm.tg.ts";
export * as proxy from "./sdk/proxy.tg.ts";

/** An SDK combines a compiler, a linker, a libc, and a set of basic utilities. */
export async function sdk(...args: std.Args<sdk.Arg>): Promise<tg.Directory> {
	let {
		host,
		proxyCompiler,
		proxyLinker,
		proxyStrip,
		target,
		toolchain: toolchain_,
		linker,
	} = await sdk.arg(...args);
	const hostOs = std.triple.os(host);

	// Determine host toolchain.
	let toolchain: tg.Directory | undefined = undefined;
	if (toolchain_ === "gnu") {
		if (hostOs === "darwin") {
			throw new Error(`The GCC toolchain is not available on macOS`);
		}
		toolchain = await tg.build(gnu.toolchain, { host, target });
	} else if (toolchain_ === "llvm") {
		let arg: llvm.LLVMArg = { host, target };
		toolchain = await tg.build(llvm.toolchain, arg);
	} else {
		toolchain = toolchain_;
	}
	tg.assert(toolchain);

	const { flavor } = await std.sdk.toolchainComponents({
		env: await std.env.arg(toolchain, { utils: false }),
		host,
		target,
	});

	// Swap linker if requested.
	let linkerExe: tg.File | tg.Symlink | tg.Template | undefined = undefined;
	if (linker) {
		if (linker instanceof tg.Symlink || linker instanceof tg.File) {
			linkerExe = linker;
		} else {
			switch (linker) {
				case "bfd": {
					if (flavor === "llvm") {
						const binutilsDir = await tg.build(binutils, { host });
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
					const moldArtifact = await tg.build(mold, { host });
					linkerExe = tg.File.expect(await moldArtifact.get("bin/mold"));
					break;
				}
			}
		}
	}

	// Proxy the host toolchain.
	let proxyArg: proxy.Arg = {
		compiler: proxyCompiler,
		linker: proxyLinker,
		strip: proxyStrip,
		toolchain: toolchain,
		build: host,
		host: target,
	};
	if (linkerExe) {
		proxyArg = { ...proxyArg, linkerExe };
	}
	return await tg.build(proxy.env, proxyArg);
}

export namespace sdk {
	/** The possible types to pass to `std.sdk()`. Pass `undefined` or `true` to get the default SDK, `false` for an empty env, or use the `ArgObject` to configure the provided env. */
	export type Arg = undefined | ArgObject;

	export type ArgObject = {
		/** The machine this SDK will compile on. */
		host?: string;
		/** An alternate linker to use. */
		linker?: LinkerKind | undefined;
		/** Use the compiler proxy? Default: false. */
		proxyCompiler?: boolean;
		/** Use the linker proxy? Default: true. */
		proxyLinker?: boolean;
		/** Use the strip proxy? Default: true. */
		proxyStrip?: boolean;
		/** The machine this SDK produces executables for. */
		target?: string;
		/** Env containing the compiler. If not provided, will default to a native GCC toolchain. */
		toolchain?: sdk.ToolchainKind;
	};

	export const arg = async (...args: std.Args<Arg>) => {
		let {
			host: host_,
			linker,
			proxyCompiler = false,
			proxyLinker = true,
			proxyStrip = true,
			target,
			toolchain: toolchain_,
		} = await std.args.apply<sdk.Arg, sdk.ArgObject>({
			args,
			map: async (arg) => {
				if (arg === undefined) {
					return {};
				} else {
					return arg;
				}
			},
			reduce: {},
		});

		// Obtain host and targets.
		let host = host_ ?? (await std.triple.host());
		const hostOs = std.triple.os(host);

		if (hostOs === "darwin" && linker && linker !== "lld") {
			throw new Error(`Alternate linkers are only available for Linux hosts.`);
		}

		// If no target is set, the target is the host.
		if (!target) {
			target = host;
		}

		// Set the default toolchain if not provided.
		if (toolchain_ === undefined) {
			toolchain_ = hostOs === "darwin" ? "llvm" : "gnu";
		}

		// If we're building our own toolchain, canonicalize the host and targets.
		if (toolchain_ === "gnu" || toolchain_ === "llvm") {
			host = sdk.canonicalTriple(host);
			target = sdk.canonicalTriple(target);
		}

		return {
			host,
			proxyCompiler,
			proxyLinker,
			proxyStrip,
			target,
			toolchain: toolchain_,
			linker,
		};
	};

	///////// QUERIES

	type ProvidesToolchainArg = {
		env: std.env.EnvObject;
		host?: string | undefined;
		target?: string | undefined;
	};

	const requiredCompilerComponents = (os: string, flavor: "gnu" | "llvm") => {
		const cc = flavor === "llvm" ? "clang" : "gcc";
		const cxx = flavor === "llvm" ? "clang++" : "g++";
		const ld = os === "linux" && flavor === "llvm" ? "ld.lld" : "ld";
		return [cc, cxx, ld];
	};

	const requiredUtils = ["ar", "nm", "ranlib", "strip"];

	/** Assert that an env provides an toolchain. */
	export const assertProvidesToolchain = async (arg: ProvidesToolchainArg) => {
		const { env, host: host_, target: target_ } = arg;

		const llvm = await std.env.provides({ env, names: ["clang"] });

		const host = canonicalTriple(host_ ?? (await std.triple.host()));
		const target = canonicalTriple(target_ ?? host);
		const os = std.triple.os(target);
		const isCross = host !== target;

		// For cross-compilation, require prefixed tools
		if (isCross && !llvm) {
			const targetPrefix = `${target}-`;
			await std.env.assertProvides({
				env,
				names: requiredUtils.map((name) => `${targetPrefix}${name}`),
			});
			const compilerComponents = requiredCompilerComponents(os, "gnu");
			await std.env.assertProvides({
				env,
				names: compilerComponents.map((name) => `${targetPrefix}${name}`),
			});
		} else {
			// For native or LLVM, try without prefix first, then with prefix
			const compilerComponents = requiredCompilerComponents(
				os,
				llvm ? "llvm" : "gnu",
			);

			try {
				await std.env.assertProvides({
					env,
					names: requiredUtils,
				});
				await std.env.assertProvides({
					env,
					names: compilerComponents,
				});
			} catch {
				// If unprefixed fails, try with prefix
				const targetPrefix = `${target}-`;
				await std.env.assertProvides({
					env,
					names: requiredUtils.map((name) => `${targetPrefix}${name}`),
				});
				await std.env.assertProvides({
					env,
					names: compilerComponents.map((name) => `${targetPrefix}${name}`),
				});
			}
		}
		return true;
	};

	/** Determine whether an env provides an toolchain. */
	export const providesToolchain = async (
		arg: ProvidesToolchainArg,
	): Promise<boolean> => {
		const { env, host: host_, target: target_ } = arg;
		const host = canonicalTriple(host_ ?? (await std.triple.host()));
		const target = canonicalTriple(target_ ?? host);
		const os = std.triple.os(target);
		const isCross = host !== target;
		const llvm = await std.env.provides({ env, names: ["clang"] });

		const compilerComponents = requiredCompilerComponents(
			os,
			llvm ? "llvm" : "gnu",
		);

		// For cross-compilation with GNU, require prefixed tools
		if (isCross && !llvm) {
			const targetPrefix = `${target}-`;
			return std.env.provides({
				env,
				names: compilerComponents.map((name) => `${targetPrefix}${name}`),
			});
		} else {
			// For native or LLVM, try without prefix first
			const hasUnprefixed = await std.env.provides({
				env,
				names: compilerComponents,
			});
			if (hasUnprefixed) {
				return true;
			}

			// Try with prefix as fallback
			const targetPrefix = `${target}-`;
			return std.env.provides({
				env,
				names: compilerComponents.map((name) => `${targetPrefix}${name}`),
			});
		}
	};

	/** Locate the C and C++ compilers, linker, and ld.so from a toolchain. */
	export const toolchainComponents = async (
		arg?: ToolchainEnvArg,
	): Promise<ToolchainComponents> => {
		const { env, host: host_, target: targetTriple } = arg ?? {};

		if (env === undefined) {
			throw new Error("No environment provided.");
		}

		// Make sure we have a toolchain.
		await sdk.assertProvidesToolchain({
			env,
			host: host_,
			target: targetTriple,
		});

		const host = await determineToolchainHost({
			env,
			host: host_,
			target: targetTriple,
		});
		const os = std.triple.os(host);
		const target = targetTriple ?? host;
		const standardizedTarget = std.sdk.canonicalTriple(target);
		const detectedHost = await std.triple.host();
		const host__ = host_ ?? detectedHost;
		const standardizedHost = std.sdk.canonicalTriple(host__);
		const isCross = isCrossCompilation(standardizedHost, target);

		// Detect compilers and determine flavor and prefix
		const compilerInfo = await detectCompilers(env, os, target, isCross);

		// Get toolchain directory and create symlinks
		const directory = await getToolchainDirectory(
			env,
			compilerInfo,
			compilerInfo.targetPrefix,
		);
		const { cc, cxx, fortran } = await createCompilerSymlinks(
			directory,
			compilerInfo,
			compilerInfo.targetPrefix,
		);

		// Locate linker
		const ld = await locateLinker(
			directory,
			env,
			os,
			compilerInfo.flavor,
			compilerInfo.targetPrefix,
		);

		// Locate dynamic interpreter and lib directory
		const { ldso, libDir } = await locateDynamicComponents(
			directory,
			env,
			os,
			target,
			host,
			isCross,
		);

		// Locate strip utility
		const stripName = compilerInfo.targetPrefix
			? `${compilerInfo.targetPrefix}strip`
			: "strip";
		const strip = await std.env.which({ env, name: stripName });

		return {
			cc,
			cxx,
			fortran,
			directory,
			flavor: compilerInfo.flavor,
			host,
			ld,
			ldso,
			libDir,
			strip,
			target,
		};
	};

	type CompilerInfo = {
		cc: tg.File | tg.Symlink;
		cxx: tg.File | tg.Symlink;
		fortran?: tg.File | tg.Symlink | undefined;
		flavor: sdk.ToolchainFlavor;
		targetPrefix: string;
	};

	const isCrossCompilation = (
		standardizedHost: string,
		target: string,
	): boolean => {
		return (
			std.triple.arch(standardizedHost) !== std.triple.arch(target) ||
			std.triple.os(standardizedHost) !== std.triple.os(target) ||
			std.triple.environment(standardizedHost) !==
				std.triple.environment(target)
		);
	};

	const detectCompilers = async (
		env: any,
		os: string,
		target: string,
		isCross: boolean,
	): Promise<CompilerInfo> => {
		const preferredFlavor: "gnu" | "llvm" = os === "linux" ? "gnu" : "llvm";

		// For cross-compilation, require prefixed tools
		if (isCross) {
			const targetPrefix = `${target}-`;
			const result = await tryDetectCompilerFlavor(
				env,
				preferredFlavor,
				targetPrefix,
			);
			if (!result) {
				throw new Error(
					`No suitable cross-compiler found for ${target} (tried ${preferredFlavor} toolchain)`,
				);
			}
			return { ...result, targetPrefix };
		}

		// For native compilation, try without prefix first, then with prefix
		let result = await tryDetectCompilerFlavor(env, preferredFlavor, "");
		if (result) {
			return { ...result, targetPrefix: "" };
		}

		// Try with prefix
		const targetPrefix = `${target}-`;
		result = await tryDetectCompilerFlavor(env, preferredFlavor, targetPrefix);
		if (result) {
			return { ...result, targetPrefix };
		}

		// Fall back to other flavor without prefix
		const fallbackFlavor: "gnu" | "llvm" =
			preferredFlavor === "gnu" ? "llvm" : "gnu";
		const fallbackResult = await tryDetectCompilerFlavor(
			env,
			fallbackFlavor,
			targetPrefix,
		);

		tg.assert(
			fallbackResult,
			`No suitable compiler found (tried both GNU and LLVM toolchains)`,
		);

		// Try fallback with prefix
		result = await tryDetectCompilerFlavor(env, fallbackFlavor, targetPrefix);
		if (result) {
			return { ...result, targetPrefix };
		}

		throw new Error(
			`No suitable compiler found (tried both GNU and LLVM toolchains)`,
		);
	};

	const tryDetectCompilerFlavor = async (
		env: std.env.EnvObject,
		flavor: "gnu" | "llvm",
		targetPrefix: string,
	): Promise<Omit<CompilerInfo, "targetPrefix"> | undefined> => {
		if (flavor === "gnu") {
			return await tryDetectGnuCompilers(env, targetPrefix);
		} else {
			return await tryDetectLlvmCompilers(env, targetPrefix);
		}
	};

	const tryDetectGnuCompilers = async (
		env: std.env.EnvObject,
		targetPrefix: string,
	): Promise<Omit<CompilerInfo, "targetPrefix"> | undefined> => {
		const gcc = await std.env.tryWhich({ env, name: `${targetPrefix}gcc` });
		if (!gcc) {
			return undefined;
		}

		const gxx = await std.env.tryWhich({ env, name: `${targetPrefix}g++` });
		if (!gxx) {
			throw new Error(`Found ${targetPrefix}gcc but not ${targetPrefix}g++.`);
		}

		const gfortran = await std.env.tryWhich({
			env,
			name: `${targetPrefix}gfortran`,
		});

		return {
			cc: gcc,
			cxx: gxx,
			fortran: gfortran,
			flavor: "gnu",
		};
	};

	const tryDetectLlvmCompilers = async (
		env: std.env.EnvObject,
		targetPrefix: string,
	): Promise<Omit<CompilerInfo, "targetPrefix"> | undefined> => {
		const clang = await std.env.tryWhich({ env, name: "clang" });
		if (!clang) {
			return undefined;
		}

		const clangxx = await std.env.tryWhich({ env, name: "clang++" });
		if (!clangxx) {
			throw new Error("Found clang but not clang++.");
		}

		return {
			cc: clang,
			cxx: clangxx,
			flavor: "llvm",
		};
	};

	const getToolchainDirectory = async (
		env: std.env.EnvObject,
		compilerInfo: CompilerInfo,
		targetPrefix?: string,
	): Promise<tg.Directory> => {
		const compilerName = compilerInfo.flavor === "gnu" ? "gcc" : "clang";

		const directory = await std.env.whichArtifact({
			name: `${targetPrefix}${compilerName}`,
			env,
		});
		if (!directory) {
			throw new Error("Unable to find toolchain directory.");
		}

		return directory;
	};

	const createCompilerSymlinks = async (
		directory: tg.Directory,
		compilerInfo: CompilerInfo,
		targetPrefix: string,
	): Promise<{
		cc: tg.Symlink;
		cxx: tg.Symlink;
		fortran?: tg.Symlink | undefined;
	}> => {
		const compiler =
			compilerInfo.flavor === "gnu" ? `${targetPrefix}gcc` : "clang";
		const cxxCompiler =
			compilerInfo.flavor === "gnu" ? `${targetPrefix}g++` : "clang++";

		const cc = await tg.symlink(tg`${directory}/bin/${compiler}`);
		const cxx = await tg.symlink(tg`${directory}/bin/${cxxCompiler}`);

		let fortran;
		if (compilerInfo.fortran) {
			fortran = await tg.symlink(tg`${directory}/bin/${targetPrefix}gfortran`);
		}

		return { cc, cxx, fortran };
	};

	const locateLinker = async (
		directory: tg.Directory,
		env: std.env.EnvObject,
		os: string,
		flavor: sdk.ToolchainFlavor,
		targetPrefix: string,
	): Promise<tg.Symlink> => {
		const linkerName = getLinkerName(os, flavor, targetPrefix);

		// Try to find linker in toolchain directory first
		const foundLd = await directory.tryGet(`bin/${linkerName}`);
		if (foundLd) {
			return await tg.symlink(tg`${directory}/bin/${linkerName}`);
		}

		// Fall back to PATH search
		const ldDir = await std.env.whichArtifact({ env, name: linkerName });
		if (ldDir) {
			return await tg.symlink(tg`${ldDir}/bin/${linkerName}`);
		}

		throw new Error(`Could not find ${linkerName}`);
	};

	const getLinkerName = (
		os: string,
		flavor: "gnu" | "llvm",
		targetPrefix: string,
	): string => {
		if (os === "darwin") {
			return "ld";
		}

		return flavor === "gnu" ? `${targetPrefix}ld` : "ld.lld";
	};

	const locateDynamicComponents = async (
		directory: tg.Directory,
		env: std.env.EnvObject,
		os: string,
		target: string,
		host: string,
		isCross: boolean,
	): Promise<{ ldso?: tg.File; libDir: tg.Directory }> => {
		if (os === "darwin") {
			return await locateDarwinComponents(directory, target, isCross);
		} else {
			return await locateUnixComponents(directory, env, target, host, isCross);
		}
	};

	const locateDarwinComponents = async (
		directory: tg.Directory,
		target: string,
		isCross: boolean,
	): Promise<{ ldso?: tg.File; libDir: tg.Directory }> => {
		if (isCross) {
			const sysroot = await directory
				.get(`${target}/sysroot`)
				.then(tg.Directory.expect);
			const libDir = await sysroot.get(`lib`).then(tg.Directory.expect);

			let ldso;
			if (std.triple.environment(target) === "gnu") {
				const ldsoPath = libc.interpreterName(target);
				ldso = await sysroot.get(`lib/${ldsoPath}`).then(tg.File.expect);
			} else {
				ldso = await sysroot.get(`lib/libc.so`).then(tg.File.expect);
			}

			return { ldso, libDir };
		} else {
			const libDir = await directory.get("lib").then(tg.Directory.expect);
			return { libDir };
		}
	};

	const locateUnixComponents = async (
		directory: tg.Directory,
		env: std.env.EnvObject,
		target: string,
		host: string,
		isCross: boolean,
	): Promise<{ ldso?: tg.File; libDir: tg.Directory }> => {
		if (isCross) {
			if (std.triple.os(target) === "darwin") {
				// Target is darwin, no LDSO needed
				const libDir = tg.Directory.expect(await directory.tryGet("lib"));
				return { libDir };
			} else {
				const libDir = tg.Directory.expect(
					await directory.tryGet(`${target}/lib`),
				);
				const ldsoPath = libc.interpreterName(target);
				const ldso = tg.File.expect(await libDir.tryGet(ldsoPath));
				return { ldso, libDir };
			}
		} else {
			// Search LIBRARY_PATH for dynamic linker
			const ldsoPath = libc.interpreterName(host);
			for await (const [_parent, dir] of std.env.dirsInVar({
				env,
				key: "LIBRARY_PATH",
			})) {
				const foundLdso = await dir.tryGet(ldsoPath);
				if (foundLdso) {
					const ldso = tg.File.expect(foundLdso);
					return { ldso, libDir: dir };
				}
			}
			throw new Error("Could not find dynamic linker in LIBRARY_PATH");
		}
	};

	type ToolchainEnvArg = {
		/** The environment to ascertain the host from. */
		env: std.env.EnvObject;
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
		flavor: ToolchainFlavor;
		host: string;
		ld: tg.Symlink;
		ldso?: tg.File | undefined; // NOTE - not present on macOS.
		libDir: tg.Directory;
		strip: tg.File | tg.Symlink;
		target: string;
	};

	export type ToolchainFlavor = "gnu" | "llvm";

	/** Determine whether an SDK supports compiling for a specific target. */
	export const supportsTarget = async (
		arg: ToolchainEnvArg,
	): Promise<boolean> => {
		const detectedHost = await std.triple.host();
		const target = arg.target ?? detectedHost;
		if (
			std.triple.os(detectedHost) === "darwin" &&
			std.triple.os(target) === "darwin"
		) {
			return true;
		}

		const allTargets = await supportedTargets(arg.env);
		return allTargets.some((t) => t === target);
	};

	/** Obtain the host system for the compilers provided by this env. Throws an error if no compiler is found. */
	export const determineToolchainHost = async (
		arg: ToolchainEnvArg,
	): Promise<string> => {
		const { env: env_, host: host_, target: target_ } = arg;
		let detectedHost = host_ ?? (await std.triple.host());
		const target = target_ ?? detectedHost;
		const isCross = detectedHost !== target;

		if (std.triple.os(detectedHost) === "darwin") {
			return detectedHost;
		}

		// Locate the C compiler using the CC variable if set, falling back to "cc" in PATH if not.
		const targetString = isCross ? target : "";
		const ccEnvVar = isCross ? `CC_${targetString.replace(/-/g, "_")}` : "CC";
		let cmd = `$${ccEnvVar}`;
		let foundCC = await std.env.tryGetArtifactByKey({
			env: env_,
			key: ccEnvVar,
		});
		const targetPrefix = isCross ? `${targetString}-` : "";
		if (!foundCC) {
			const clang = await std.env.tryWhich({ env: env_, name: "clang" });
			if (clang) {
				cmd = "clang";
				foundCC = clang as tg.File | tg.Symlink;
			} else {
				const name = `${targetPrefix}cc`;
				foundCC = await std.env.tryWhich({ env: env_, name });
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

		// If the file is a symlink, resolve it.
		if (foundCC instanceof tg.Symlink) {
			foundCC = await foundCC.resolve();
		}
		tg.assert(foundCC instanceof tg.File);

		// Inspect the file to see which system it should run on.
		const metadata = await std.file.executableMetadata(foundCC);
		let detectedArch: string | undefined;
		if (metadata.format === "elf") {
			detectedArch = metadata.arch;
		} else if (metadata.format === "mach-o") {
			detectedArch = metadata.arches[0] ?? "aarch64";
		}
		if (metadata.format !== "shebang") {
			const os = metadata.format === "elf" ? "linux" : "darwin";
			const arch = detectedArch ?? "x86_64";
			detectedHost = `${arch}-${os}`;
		}

		// For cross compilers, use the host detected.  For host compilers, run the compiler on the detected system to ask what host triple it's configured for.
		if (isCross) {
			return detectedHost;
		} else {
			const output = await std.build`${cmd} -dumpmachine > $OUTPUT`
				.bootstrap(true)
				.env(env_)
				.host(std.triple.archAndOs(detectedHost))
				.then(tg.File.expect);
			const host = (await output.text()).trim();
			std.triple.assert(host);
			return host;
		}
	};

	/** Retreive the full range of targets an SDK supports. */
	export const supportedTargets = async (
		sdk: std.env.EnvObject,
	): Promise<Array<string>> => {
		// Collect all available `*cc` binaries.
		const foundTargets: Set<string> = new Set();

		for await (const [name, _] of std.env.binsInPath({
			env: sdk,
			predicate: (name) => name.endsWith("-cc"),
		})) {
			const triple = name.slice(0, -3);
			foundTargets.add(triple);
		}

		return Array.from(foundTargets);
	};

	export const resolveHostAndTarget = async (
		arg?: HostAndTargetsOptions,
	): Promise<HostAndTarget> => {
		const host = arg?.host ?? (await std.triple.host());
		const target = arg?.target ?? host;
		return { host, target };
	};

	type ProxyTestArg = {
		// Only the lld and mold linkers leave comments in the binary we can search for.
		flavor: sdk.ToolchainFlavor;
		linkerFlavor?: "LLD" | "mold" | undefined;
		parameters: ProxyTestParameters;
		proxiedLinker?: boolean;
		sdkEnv: std.env.Arg;
		host?: string;
		target?: string;
	};

	/** Compile a program and assert a correct wrapper for the target was produced. If `host == target`, ensure the wrapper execute and produces the expected output. */
	export const assertCompiler = async (arg: ProxyTestArg) => {
		const proxiedLinker = arg.proxiedLinker ?? false;
		const linkerFlavor = arg.linkerFlavor;
		const flavor = arg.flavor;
		// Determine requested host and target.
		const expected = await resolveHostAndTarget({
			host: arg.host,
			target: arg.target,
		});
		const expectedHost = expected.host;
		const expectedTarget = expected.target;
		tg.assert(expectedTarget);

		// Determine compiler target prefix, if any. For LLVM, instead add a -target flag.
		const isCross = expectedHost !== expectedTarget;
		const targetPrefix =
			flavor === "gnu" && isCross ? `${expectedTarget}-` : ``;

		// Set up test parameters.
		const { lang, testProgram, expectedOutput, title } = arg.parameters;
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
		if (flavor === "llvm") {
			cmd = `${cmd} -target ${sdk.canonicalTriple(expectedTarget)}`;
		}
		tg.assert(cmd);

		// Compile the test source using the expected host system.
		let langStr: string = lang;
		if (lang === "fortran") {
			langStr = "f95";
		}
		const compiledProgram =
			await std.build`echo "testing ${title}, proxied linker: ${proxiedLinker.toString()}"
				set -x
				${cmd} -v -x${langStr} ${testProgram} -o $OUTPUT`
				.bootstrap(true)
				.env(
					std.env.arg(
						arg.sdkEnv,
						{
							TANGRAM_LINKER_TRACING: "tangram_ld_proxy=trace",
						},
						{ utils: false },
					),
				)
				.host(std.triple.archAndOs(expectedHost))
				.then(tg.File.expect);

		// Assert the resulting program was compiled for the expected target.
		const expectedArch = std.triple.arch(expectedTarget);
		let metadata = await std.file.executableMetadata(compiledProgram);
		if (metadata.format === "elf") {
			const actualArch = metadata.arch;
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
			const expectedInterpreter = libc.interpreterName(expectedTarget);
			const actualInterpreter = metadata.interpreter;
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
			const testOutput = await std.build`${compiledProgram} > $OUTPUT`
				.bootstrap(true)
				.env({ TANGRAM_WRAPPER_TRACING: "tangram_wrapper=trace" })
				.host(std.triple.archAndOs(expectedHost))
				.then(tg.File.expect);
			const outputText = (await testOutput.text()).trim();
			tg.assert(outputText === expectedOutput);
		}
		return true;
	};

	/** Assert the given env provides everything it should for a particuar arg. */
	export const assertValid = async (
		toolchainDir: tg.Directory,
		arg: sdk.Arg,
	) => {
		const expected = await resolveHostAndTarget(arg);
		const env = await std.env.arg(toolchainDir, { utils: true });

		// Assert we can determine a host and it matches the expected.
		const actualHost = await sdk.determineToolchainHost({
			env,
			host: expected.host,
			target: expected.target,
		});
		const actualHostArch = std.triple.arch(actualHost);
		const expectedHostArch = std.triple.arch(expected.host);
		const actualHostOs = std.triple.os(actualHost);
		const expectedHostOs = std.triple.os(expected.host);
		tg.assert(
			actualHostArch === expectedHostArch,
			`Given env provides an SDK with host arch ${actualHostArch} instead of expected ${expectedHostArch}.`,
		);
		tg.assert(
			actualHostOs === expectedHostOs,
			`Given env provides an SDK with host os ${actualHostOs} instead of expected ${expectedHostOs}.`,
		);
		const expectedHostEnvironment = std.triple.environment(expected.host);
		if (expectedHostEnvironment) {
			const actualHostEnvironment = std.triple.environment(actualHost);
			tg.assert(
				actualHostEnvironment === expectedHostEnvironment,
				`Given env provides an SDK with host environment ${actualHostEnvironment} instead of expected ${expectedHostEnvironment}.`,
			);
		}

		// Assert it can compile and wrap for all requested targets.
		const allTargets = await sdk.supportedTargets(env);
		// If there is an un-prefixed CC, add the host to the list.
		if (await std.env.tryWhich({ env, name: "cc" })) {
			allTargets.push(actualHost);
		}
		await Promise.all(
			allTargets.map(async (target) => {
				const flavor = (await std.env.provides({ env, name: "clang" }))
					? "llvm"
					: "gnu";

				// Make sure we found this target in the env.
				if (flavor === "gnu") {
					tg.assert(
						allTargets.some(
							(t) =>
								std.triple.arch(t) === std.triple.arch(target) &&
								std.triple.os(t) === std.triple.os(target),
						),
					);
				}

				let proxiedLinker = arg?.proxyLinker ?? true;

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
					flavor,
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
						flavor,
						linkerFlavor,
						parameters: testCParameters,
						proxiedLinker: false,
						sdkEnv: await std.env.arg(
							env,
							{
								TANGRAM_LINKER_PASSTHROUGH: true,
							},
							{ utils: false },
						),
						host: expected.host,
						target,
					});
				}

				// Test C++.
				await assertCompiler({
					flavor,
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
						flavor,
						linkerFlavor,
						parameters: testCxxParameters,
						proxiedLinker: false,
						sdkEnv: await std.env.arg(
							env,
							{
								TANGRAM_LINKER_PASSTHROUGH: true,
							},
							{ utils: false },
						),
						host: expected.host,
						target,
					});
				}

				// Test C++ atomic header.

				await assertCompiler({
					flavor,

					linkerFlavor,

					parameters: testCxxAtomicParameters,

					proxiedLinker,

					sdkEnv: env,

					host: expected.host,

					target,
				});

				if (proxiedLinker) {
					// Test C++ atomic with linker proxy bypass.
					await assertCompiler({
						flavor,
						linkerFlavor,
						parameters: testCxxAtomicParameters,
						proxiedLinker: false,
						sdkEnv: await std.env.arg(
							env,
							{
								TANGRAM_LINKER_PASSTHROUGH: true,
							},
							{ utils: false },
						),
						host: expected.host,
						target,
					});
				}

				// Test Fortran.
				if (
					actualHostOs !== "darwin" &&
					std.triple.os(target) !== "darwin" &&
					arg?.toolchain !== "llvm"
				) {
					await assertCompiler({
						flavor,
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
							flavor,
							linkerFlavor,
							parameters: testFortranParameters,
							proxiedLinker: false,
							sdkEnv: await std.env.arg(
								env,
								{
									TANGRAM_LINKER_PASSTHROUGH: true,
								},
								{ utils: false },
							),
							host: expected.host,
							target,
						});
					}
				}
			}),
		);
	};

	export const canonicalTriple = (triple: string): string => {
		const components = std.triple.components(std.triple.normalize(triple));
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
	};

	export type HostAndTarget = {
		host: string;
		target: string;
	};

	export type LinkerKind = "bfd" | "lld" | "mold" | tg.Symlink | tg.File;

	export type ToolchainKind = sdk.ToolchainFlavor | tg.Directory;
}

/** Check whether Tangram supports building a cross compiler from the host to the target. */
type ValidateCrossTargetArg = {
	host: string;
	target: string;
};

// FIXME - this is never called?
const validateCrossTarget = (arg: ValidateCrossTargetArg) => {
	const { host, target } = arg;

	// All triples can compile for themselves.
	if (host === target) {
		return true;
	}

	const hostOs = std.triple.os(host);
	const targetOs = std.triple.os(target);

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
export const mergeLibDirs = async (dir: tg.Directory) => {
	for await (const [name, artifact] of dir) {
		// If we find a lib64, merge it with the adjacent lib.
		if (artifact instanceof tg.Directory) {
			if (name === "lib64") {
				const maybeLibDir = await dir.tryGet("lib");
				if (!maybeLibDir) {
					// There was no adjacent lib - this is best effort. Do nothing.
					continue;
				}
				// If we found it, deep merge the lib64 into it.
				const libDir = maybeLibDir;
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
				const mergedSubdir = await mergeLibDirs(artifact);
				dir = await tg.directory(dir, {
					[name]: mergedSubdir,
				});
			}
		}
	}
	return dir;
};

/** Assert the given ELF file contains a comment that includes the provided string. */
export const assertComment = async (
	exe: tg.File,
	toolchain: std.env.Arg,
	textToMatch: string,
) => {
	const elfComment =
		await std.build`readelf -p .comment ${exe} | grep ${textToMatch} > $OUTPUT`
			.bootstrap(true)
			.env(
				std.env.arg(toolchain, bootstrap.utils(), bootstrap.shell(), {
					utils: false,
				}),
			)
			.then(tg.File.expect);
	const text = await elfComment.text();
	tg.assert(text.includes(textToMatch));
};

//////// TESTS

const testCParameters: ProxyTestParameters = {
	expectedOutput: "Hello, Tangram!",
	lang: "c",
	testProgram: tg.file`
		#include <stdio.h>

		int main() {
			printf("Hello, Tangram!\\n");
			return 0;
		}`,
	title: "c-hello",
};

const testCxxParameters: ProxyTestParameters = {
	expectedOutput: `new Tangram().send("Hello!")`,
	lang: "c++",
	testProgram: tg.file`
		#include <iostream>

		int main() {
			std::cout << "new Tangram().send(\\"Hello!\\")" << std::endl;
			return 0;
		}`,
	title: "c++-hello",
};

const testCxxAtomicParameters: ProxyTestParameters = {
	expectedOutput: "Atomic operations working: 42",
	lang: "c++",
	testProgram: tg.file`
		#include <iostream>
		#include <atomic>

		int main() {
			std::atomic<int> value{0};
			value.store(42);
			int result = value.load();
			std::cout << "Atomic operations working: " << result << std::endl;
			return 0;
		}`,
	title: "c++-atomic",
};

const testFortranParameters: ProxyTestParameters = {
	expectedOutput: "Hello, Fortran!",
	lang: "fortran",
	testProgram: tg.file`
		program hello
			print *, "Hello, Fortran!"
		end program hello`,
	title: "fortran-hello",
};

type ProxyTestParameters = {
	expectedOutput: string;
	lang: "c" | "c++" | "fortran";
	testProgram: tg.Unresolved<tg.File>;
	title: string;
};

export const testDefault = async () => {
	const env = await sdk();
	const detectedHost = await std.triple.host();
	await sdk.assertValid(env, { host: detectedHost });
	return env;
};

export const testMold = async () => {
	const detectedHost = await std.triple.host();
	if (std.triple.os(detectedHost) !== "linux") {
		throw new Error(`mold is only available on Linux`);
	}

	const sdkArg = { host: detectedHost, linker: "mold" as const };

	const moldSdk = await sdk(sdkArg);

	// Ensure that the SDK is valid.
	await sdk.assertValid(moldSdk, sdkArg);
	return moldSdk;
};

export const testGccLld = async () => {
	const detectedHost = await std.triple.host();
	if (std.triple.os(detectedHost) !== "linux") {
		throw new Error(`mold is only available on Linux`);
	}

	const sdkArg = { host: detectedHost, linker: "lld" as const };

	const lldSdk = await sdk(sdkArg);

	// Ensure that the SDK is valid.
	await sdk.assertValid(lldSdk, sdkArg);
	return lldSdk;
};

export const testMusl = async () => {
	const host = await std.triple.host();
	if (std.triple.os(host) !== "linux") {
		throw new Error(`musl is only available on Linux`);
	}
	const muslHost = std.triple.create(host, { environment: "musl" });
	const sdkArg = { host: muslHost };
	const env = await sdk(sdkArg);
	await sdk.assertValid(env, sdkArg);
	return env;
};

export const testCrossGcc = async () => {
	const detectedHost = await std.triple.host();
	const detectedOs = std.triple.os(detectedHost);
	if (detectedOs === "darwin") {
		throw new Error(`Cross-compilation is not supported on Darwin`);
	}
	const detectedArch = std.triple.arch(detectedHost);
	const crossArch = detectedArch === "x86_64" ? "aarch64" : "x86_64";
	const crossTarget = sdk.canonicalTriple(
		std.triple.create(detectedHost, { arch: crossArch }),
	);
	const sdkArg = { host: detectedHost, target: crossTarget };
	const env = await sdk(sdkArg);
	await sdk.assertValid(env, sdkArg);
	return env;
};

export const testLLVM = async () => {
	const env = await sdk({ toolchain: "llvm" });
	await sdk.assertValid(env, { toolchain: "llvm" });
	return env;
};

export const testLLVMMold = async () => {
	const detectedHost = await std.triple.host();
	if (std.triple.os(detectedHost) !== "linux") {
		throw new Error(`mold is only available on Linux`);
	}

	const sdkArg = {
		host: detectedHost,
		linker: "mold" as const,
		toolchain: "llvm" as const,
	};

	const moldSdk = await sdk(sdkArg);

	// Ensure that the SDK is valid.
	await sdk.assertValid(moldSdk, sdkArg);

	return moldSdk;
};

export const testLLVMBfd = async () => {
	const detectedHost = await std.triple.host();
	if (std.triple.os(detectedHost) !== "linux") {
		throw new Error(`bfd is only available on Linux`);
	}

	const sdkArg = {
		host: detectedHost,
		linker: "bfd" as const,
		toolchain: "llvm" as const,
	};

	const bfdSdk = await sdk(sdkArg);

	// Ensure that the SDK is valid.
	await sdk.assertValid(bfdSdk, sdkArg);
	return bfdSdk;
};

export const testExplicitGlibcVersion = async () => {
	const host = await std.triple.host();
	if (std.triple.os(host) !== "linux") {
		throw new Error(`glibc is only available on Linux`);
	}
	const oldGlibcHost = std.triple.create(host, {
		environment: "gnu",
		environmentVersion: "2.37",
	});
	const sdkArg = { host: oldGlibcHost };
	const env = await sdk(sdkArg);
	await sdk.assertValid(env, sdkArg);
	return env;
};

export const testLLVMMusl = async () => {
	const host = await std.triple.host();
	if (std.triple.os(host) !== "linux") {
		throw new Error(`musl is only available on Linux`);
	}
	const muslHost = std.triple.create(host, { environment: "musl" });
	const sdkArg = { host: muslHost, toolchain: "llvm" as const };
	const env = await sdk(sdkArg);
	await sdk.assertValid(env, sdkArg);
	return env;
};

export const testCrossLLVM = async () => {
	const detectedHost = await std.triple.host();
	const detectedOs = std.triple.os(detectedHost);
	if (detectedOs === "darwin") {
		throw new Error(`Cross-compilation is not supported on Darwin`);
	}
	const detectedArch = std.triple.arch(detectedHost);
	const crossArch = detectedArch === "x86_64" ? "aarch64" : "x86_64";
	const crossTarget = sdk.canonicalTriple(
		std.triple.create(detectedHost, { arch: crossArch }),
	);
	const sdkArg: sdk.Arg = {
		host: detectedHost,
		target: crossTarget,
		toolchain: "llvm",
	};
	const env = await sdk(sdkArg);
	await sdk.assertValid(env, sdkArg);
	return env;
};

export const testDarwinToLinux = async () => {
	const targets = [
		"aarch64-unknown-linux-gnu",
		"aarch64-unknown-linux-musl",
		"x86_64-unknown-linux-gnu",
		"x86_64-unknown-linux-musl",
	];
	await Promise.all(
		targets.map(async (target) => await testDarwinToLinuxSingle(target)),
	);
	return true;
};

export const testDarwinToLinuxSingle = async (target: string) => {
	const host = await std.triple.host();
	if (std.triple.os(host) !== "darwin") {
		throw new Error(`This test is only valid on Darwin`);
	}

	const sdkArg = { host, target };
	const env = await sdk(sdkArg);
	await sdk.assertValid(env, sdkArg);
	return env;
};

export const testLinuxToDarwin = async () => {
	const host = await std.triple.host();
	if (std.triple.os(host) !== "linux") {
		throw new Error(`This test is only valid on Linux`);
	}

	const target = "aarch64-apple-darwin";
	const sdkArg = { host, target };
	const env = await sdk(sdkArg);
	await sdk.assertValid(env, sdkArg);
	return true;
};

export const testAllNativeProxied = async () => {
	await Promise.all(
		(await allNativeProxiedArgs()).map(async (arg) => {
			await sdk.assertValid(await sdk(arg), arg);
		}),
	);
	return true;
};

export const allNativeProxiedArgs = async (): Promise<Array<std.sdk.Arg>> => {
	const detectedHost = await std.triple.host();
	const detectedOs = std.triple.os(detectedHost);

	if (detectedOs === "darwin") {
		return [{}];
	}

	const hostGnu = sdk.canonicalTriple(detectedHost);

	return [{}, { toolchain: "llvm" }, { linker: "mold" }];
};

export const allSdkArgs = async (): Promise<Array<std.sdk.Arg>> => {
	const detectedHost = await std.triple.host();
	const detectedOs = std.triple.os(detectedHost);

	if (detectedOs === "darwin") {
		return [{}, { proxyLinker: false }];
	}

	const hostGnu = sdk.canonicalTriple(detectedHost);
	const hostMusl = std.triple.create(hostGnu, { environment: "musl" });
	const detectedHostArch = std.triple.arch(detectedHost);
	const crossArch = detectedHostArch === "x86_64" ? "aarch64" : "x86_64";
	const crossGnu = std.triple.create(hostGnu, { arch: crossArch });
	const crossMusl = std.triple.create(crossGnu, { environment: "musl" });

	return [
		{},
		{ proxyLinker: false },
		{ host: hostMusl },
		{ host: hostMusl, proxyLinker: false },
		{ host: hostGnu, target: crossGnu },
		{ host: hostGnu, target: crossGnu, proxyLinker: false },
		{ host: hostGnu, target: crossMusl },
		{ host: hostGnu, target: crossMusl, proxyLinker: false },
		{ host: hostMusl, target: crossMusl },
		{ host: hostMusl, target: crossMusl, proxyLinker: false },
		{ host: hostMusl, target: crossGnu },
		{ host: hostMusl, target: crossGnu, proxyLinker: false },
		{ host: hostGnu, target: crossGnu, toolchain: "llvm" },
		{ host: hostGnu, target: crossGnu, toolchain: "llvm", proxyLinker: false },
		{ linker: "mold" },
		{ linker: "mold", proxyLinker: false },
		{ toolchain: "llvm" },
		{ toolchain: "llvm", proxyLinker: false },
		{ toolchain: "llvm", linker: "mold" },
		{ toolchain: "llvm", linker: "mold", proxyLinker: false },
		{ toolchain: "llvm", linker: "bfd" },
		{ toolchain: "llvm", linker: "bfd", proxyLinker: false },
		{ toolchain: "gnu", linker: "lld" },
		{ toolchain: "gnu", linker: "lld", proxyLinker: false },
		{ host: std.triple.create(detectedHost, { environmentVersion: "2.37" }) },
		{
			host: std.triple.create(detectedHost, { environmentVersion: "2.37" }),
			proxyLinker: false,
		},
	];
};

export const assertAllSdks = async () => {
	await Promise.all(
		(await allSdkArgs()).map(async (arg) => {
			await sdk.assertValid(await sdk(arg), arg);
		}),
	);
	return true;
};
