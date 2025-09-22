import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.ts";
import { $ } from "../tangram.ts";
import * as gnu from "./gnu.tg.ts";
import * as cmake from "./cmake.tg.ts";
import * as dependencies from "./dependencies.tg.ts";
import * as utils from "../utils.tg.ts";
import git from "./llvm/git.tg.ts";
import * as libc from "./libc.tg.ts";
import ncurses from "./llvm/ncurses.tg.ts";
import cctools from "./llvm/cctools_port.tg.ts";
import { constructSysroot } from "./libc.tg.ts";
import cmakeCacheDir from "./llvm/cmake" with { type: "directory" };

export * as appleLibdispatch from "./llvm/apple_libdispatch.tg.ts";
export * as appleLibtapi from "./llvm/apple_libtapi.tg.ts";
export * as libBsd from "./llvm/libbsd.tg.ts";
export * as libMd from "./llvm/libmd.tg.ts";
export * as cctools from "./llvm/cctools_port.tg.ts";
export * as git from "./llvm/git.tg.ts";
export * as ncurses from "./llvm/ncurses.tg.ts";

export const metadata = {
	homepage: "https://llvm.org/",
	name: "llvm",
	license:
		"https://github.com/llvm/llvm-project/blob/991cfd1379f7d5184a3f6306ac10cabec742bbd2/LICENSE.TXT",
	repository: "https://github.com/llvm/llvm-project/",
	version: "20.1.8",
};

export const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:6898f963c8e938981e6c4a302e83ec5beb4630147c7311183cf61069af16333d";
	const owner = name;
	const repo = "llvm-project";
	const tag = `llvmorg-${version}`;
	const extension = ".tar.xz";
	const url = `https://github.com/${owner}/${repo}/releases/download/${tag}/${repo}-${version}.src${extension}`;
	return std.download
		.extractArchive({ checksum, url })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

export type LLVMArg = {
	build?: string;
	env?: std.env.Arg;
	host?: string;
	lto?: boolean;
	prebuilt?: boolean;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
	target?: string;
};

/** Produce a complete clang+lld distribution. */
export const toolchain = async (arg?: LLVMArg) => {
	const {
		build: build_,
		env: env_,
		host: host_,
		lto = true,
		prebuilt: prebuilt_ = true,
		sdk,
		source: source_,
		target: target_,
	} = arg ?? {};
	const host = std.sdk.canonicalTriple(host_ ?? (await std.triple.host()));

	const build = build_ ?? host;
	const target = target_ ?? host;

	if (std.triple.os(host) === "darwin") {
		const targetOs = std.triple.os(target);
		if (targetOs === "darwin") {
			return await bootstrap.sdk.env(host);
		} else if (targetOs === "linux") {
			const toolchain = bootstrap.toolchain(host);
			const lld = buildLld({ host });
			const sysroot = getLinuxSysroot(target);
			return await tg.directory(
				toolchain,
				{
					[`bin/ld`]: undefined,
					[`bin/ld64.lld`]: undefined,
					[`bin/ld-classic`]: undefined,
				},
				lld,
				{ [`bin/ld`]: tg.symlink("./lld") },
				{
					[`${target}/sysroot`]: sysroot,
				},
			);
		} else {
			return tg.unimplemented(`unrecognized target OS: ${targetOs}`);
		}
	}

	if (!prebuilt_) {
		throw new Error("only prebuilt LLVM toolchains are currently supported.");
	}
	if (prebuilt_) {
		return prebuilt({ host });
	}

	const sourceDir = source_ ?? source();

	// Define build environment.
	const m4ForBuild = dependencies.m4.build({ build, host: build });
	const bisonForBuild = dependencies.bison.build({
		build,
		host: build,
		env: m4ForBuild,
	});
	const perlForBuild = dependencies.perl.build({
		build,
		host: build,
		env: std.env.arg(m4ForBuild, bisonForBuild, { utils: false }),
	});
	const pythonForBuild = dependencies.python.build({
		build,
		host: build,
		sdk: bootstrap.sdk.arg(build),
	});
	const ncursesArtifact = ncurses({ build, host });
	const zlibArtifact = dependencies.zlib.build({ build, host });
	const deps = [
		git({ build, host: build }),
		bisonForBuild,
		m4ForBuild,
		perlForBuild,
		pythonForBuild,
		ncursesArtifact,
		zlibArtifact,
	];

	// Obtain a sysroot for the requested host.

	const sysroot = await constructSysroot({
		env: std.env.arg(bisonForBuild, m4ForBuild, pythonForBuild, {
			utils: false,
		}),
		host,
	})
		.then((dir) => dir.get(host))
		.then(tg.Directory.expect);

	const env = [...deps, env_];

	const ldsoName = libc.interpreterName(host);
	// Ensure that stage2 unproxied binaries are runnable during the build, before we have a chance to wrap them post-install.
	const stage2ExeLinkerFlags = tg`-Wl,-dynamic-linker=${sysroot}/lib/${ldsoName} -unwindlib=libunwind`;

	// Ensure that stage2 unproxied binaries are able to locate libraries during the build, without hardcoding rpaths. We'll wrap them afterwards.
	const prepare = tg`export LD_LIBRARY_PATH="${sysroot}/lib:${zlibArtifact}/lib:${ncursesArtifact}/lib:$HOME/work/lib:$HOME/work/lib/${host}"`;

	// Define default flags.
	const configure = {
		args: [
			tg`-DBOOTSTRAP_CMAKE_EXE_LINKER_FLAGS='${stage2ExeLinkerFlags}'`,
			tg`-DDEFAULT_SYSROOT=${sysroot}`,
			`-DLLVM_HOST_TRIPLE=${host}`,
			"-DLLVM_PARALLEL_LINK_JOBS=1",
			tg`-DTerminfo_ROOT=${ncursesArtifact}`,
			// NOTE - CLANG_BOOTSTRAP_PASSTHROUGH didn't work for Terminfo_ROOT, but this did.
			tg`-DBOOTSTRAP_Terminfo_ROOT=${ncursesArtifact}`,
			tg`-DZLIB_ROOT=${zlibArtifact}`,
			`-DCLANG_BOOTSTRAP_PASSTHROUGH="DEFAULT_SYSROOT;LLVM_PARALLEL_LINK_JOBS;ZLIB_ROOT"`,
		],
	};

	// Support musl sysroots.
	const isMusl = std.triple.environment(host) === "musl";
	if (isMusl) {
		configure.args.push("-DLIBCXX_HAS_MUSL_LIBC=On");
		configure.args.push("-DBOOTSTRAP_LIBCXX_HAS_MUSL_LIBC=On");
	}

	// Add additional flags from the target args.
	if (lto && !isMusl) {
		configure.args.push("-DBOOTSTRAP_LLVM_ENABLE_LTO=Thin");
	}

	// Add the cmake cache file last.
	configure.args.push(tg`-C${cmakeCacheDir}/Distribution.cmake`);

	const buildPhase = {
		command: "ninja",
		args: tg.Mutation.set(["stage2-distribution"]),
	};
	const install = {
		command: "ninja",
		args: tg.Mutation.set(["stage2-install-distribution"]),
	};
	const phases = { prepare, configure, build: buildPhase, install };

	let llvmArtifact = await cmake.build({
		...(await std.triple.rotate({ build, host })),
		env: std.env.arg(...env, { utils: false }),
		phases,
		sdk,
		source: tg`${sourceDir}/llvm`,
	});

	// Add sysroot and symlinks.
	llvmArtifact = await tg.directory(llvmArtifact, sysroot, {
		"bin/ar": tg.symlink("llvm-ar"),
		"bin/cc": tg.symlink("clang"),
		"bin/c++": tg.symlink("clang++"),
		"bin/nm": tg.symlink("llvm-nm"),
		"bin/objcopy": tg.symlink("llvm-objcopy"),
		"bin/objdump": tg.symlink("llvm-objdump"),
		"bin/ranlib": tg.symlink("llvm-ar"),
		"bin/readelf": tg.symlink("llvm-readobj"),
		"bin/strings": tg.symlink("llvm-strings"),
		"bin/strip": tg.symlink("llvm-strip"),
	});

	// The bootstrap compiler was not proxied. Manually wrap the output binaries.

	// Collect all required library paths.
	const libDir = llvmArtifact.get("lib").then(tg.Directory.expect);
	const hostLibDir = libDir.then((d) => d.get(host)).then(tg.Directory.expect);
	const ncursesLibDir = ncursesArtifact
		.then((dir) => dir.get("lib"))
		.then(tg.Directory.expect);
	const zlibLibDir = zlibArtifact
		.then((dir) => dir.get("lib"))
		.then(tg.Directory.expect);
	const libraryPaths = [libDir, hostLibDir, ncursesLibDir, zlibLibDir];

	// Wrap all ELF binaries in the bin directory.
	const binDir = await llvmArtifact.get("bin").then(tg.Directory.expect);
	for await (const [name, artifact] of binDir) {
		if (artifact instanceof tg.File) {
			const { format } = await std.file.executableMetadata(artifact);
			if (format === "elf") {
				const unwrapped = binDir.get(name).then(tg.File.expect);
				const wrapped = std.wrap(unwrapped, {
					libraryPaths,
				});
				llvmArtifact = await tg.directory(llvmArtifact, {
					[`bin/${name}`]: wrapped,
				});
			}
		}
	}

	return llvmArtifact;
};

/** Grab the LLD linker from the toolchain. */
export const lld = async (arg?: LLVMArg) => {
	const toolchainDir = await toolchain(arg);
	tg.assert(toolchainDir instanceof tg.Directory);
	// Use a template instead of the file directly so the linker proxy invokes the linker by its full name.
	return tg`${toolchainDir}/bin/ld.lld`;
};

/** Build LLD only, without the 2-stage bootstrap. */
export const buildLld = async (arg?: LLVMArg) => {
	const {
		build: build_,
		env: env_,
		host: host_,
		lto = true,
		sdk,
		source: source_,
	} = arg ?? {};
	const host = host_ ?? (await std.triple.host());
	const build = build_ ?? host;

	const sourceDir = source_ ?? source();

	const buildToolchain = await std.env.arg(bootstrap.sdk(host));

	// Define build environment.
	const buildTools = await tg.build(dependencies.buildTools, {
		host: build,
		buildToolchain,
		level: "python",
	});
	const zlibArtifact = await dependencies.zlib.build({
		env: buildToolchain,
		bootstrap: true,
	});
	const deps = [buildTools, zlibArtifact];

	const env = await std.env.arg(...deps, buildToolchain, env_);

	// Define default flags.
	const configure = {
		args: [
			"-DCMAKE_BUILD_TYPE=Release",
			"-DLLVM_ENABLE_PROJECTS=lld",
			`-DLLVM_HOST_TRIPLE=${host}`,
			"-DLLVM_PARALLEL_LINK_JOBS=1",
			tg`-DZLIB_ROOT=${zlibArtifact}`,
		],
	};

	const phases = { configure };

	let output = await cmake.build({
		...(await std.triple.rotate({ build, host })),
		bootstrap: true,
		env,
		phases,
		sdk,
		source: tg`${sourceDir}/llvm`,
	});

	// Wrap lld with zlib.
	return output;
};

type LinuxToDarwinArg = {
	host: string;
	target?: string;
};

/** Produce a linux to darwin toolchain. */
import testSource from "../wrap/test/inspectProcess.c" with { type: "file" };
export const linuxToDarwin = async (arg?: LinuxToDarwinArg) => {
	const { host, target: target_ } = arg ?? {
		host: await std.triple.host(),
		target: "aarch64-apple-darwin",
	};
	const target = target_ ?? host;

	// Obtain the clang toolchain.
	let clangToolchain = await toolchain({ host }).then(tg.Directory.expect);

	// Add the sysroot to the clang toolchain.
	clangToolchain = await tg.directory(clangToolchain, {
		["sysroot"]: bootstrap.macOsSdk(),
	});

	// Add shell wrappers for clang and clang++.
	const bins = ["clang", "clang++"];
	for (const bin of bins) {
		clangToolchain = await tg.directory(clangToolchain, {
			[`bin/${target}-${bin}`]: tg.file(
				`#!/usr/bin/env sh\nset -x\ninstalldir=$(${bin} -print-search-dirs | grep 'programs: =' | sed 's/programs: =//' | cut -d':' -f1)\nexec ${bin} -target ${target} --sysroot \${installdir}/../sysroot \"$@\"`,
				{ executable: true },
			),
		});
	}

	// Obtain linker and SDK.
	const cctoolsForTarget = await cctools(std.triple.arch(target));

	// Return the combined environment.
	return await std.env.arg(clangToolchain, cctoolsForTarget, { utils: false });
};

export const testLinuxToDarwin = async (arg?: LinuxToDarwinArg) => {
	const { target } = arg ?? {
		host: await std.triple.host(),
		target: "aarch64-apple-darwin",
	};
	const combined = await linuxToDarwin(arg);
	const f = await $`
	set -x
	${target}-clang --version
	${target}-clang -v -xc ${testSource} -o $OUTPUT
	`
		.env(combined)
		.then(tg.File.expect);
	return f;
};

export const llvmMajorVersion = () => {
	return metadata.version.split(".")[0];
};

type WrapArgsArg = {
	host: string;
	target?: string;
	toolchainDir: tg.Directory;
};

/** Produce the flags and environment required to properly proxy this toolchain. */
export const wrapArgs = async (arg: WrapArgsArg) => {
	const { host, target: target_, toolchainDir } = arg;
	const target = target_ ?? host;

	let clangArgs: tg.Unresolved<Array<tg.Template.Arg>> = [];
	let clangxxArgs: tg.Unresolved<Array<tg.Template.Arg>> = [];
	let env = {};
	if (std.triple.os(host) === "darwin") {
		// If the host is darwin, set resource dir.
		// Note - the Apple Clang version provided by the OS is 17, not ${version}.
		clangArgs.push(tg`-resource-dir=${toolchainDir}/lib/clang/17.0.0`);

		const targetOs = std.triple.os(target);
		if (targetOs === "darwin") {
			// If the target is darwin, use the macOS SDK for the SDKROOT.
			env = {
				SDKROOT: tg.Mutation.setIfUnset(bootstrap.macOsSdk()),
			};
		} else if (targetOs === "linux") {
			// If the target is linux, unset any existing SDKROOT and instead use the Linux sysroot.
			env = {
				SDKROOT: tg.Mutation.unset(),
			};
			const targetSysroot = getLinuxSysroot(target);
			clangArgs.push("-target", target, tg`--sysroot=${targetSysroot}`);
		} else {
			return tg.unimplemented(`unrecognized target OS: ${targetOs}`);
		}
		clangxxArgs = [...clangArgs];
	} else {
		// If the target is darwin, set sysroot and target flags.

		// Define common flags.
		const commonFlags = ["-rtlib=compiler-rt", tg`--sysroot=${toolchainDir}`];

		// Set C flags.
		clangArgs = clangArgs.concat(commonFlags);

		// Set C++ flags.
		const cxxFlags = ["--stdlib=libc++", "-lc++", "-unwindlib=libunwind"];
		clangxxArgs = clangxxArgs.concat(commonFlags, cxxFlags);
	}

	return { clangArgs, clangxxArgs, env };
};

export const getLinuxSysroot = async (
	target: string,
): Promise<tg.Directory> => {
	const url = `https://github.com/tangramdotdev/bootstrap/releases/download/v2024.10.03/${target}-sysroot.tar.zst`;

	const checksums: Record<string, tg.Checksum> = {
		"aarch64-unknown-linux-gnu":
			"sha256:36d4a5a5b7e7e742c17a1c42fcb12814a20e365b8d51074f0d0d447ac9a8a0e4",
		"aarch64-unknown-linux-musl":
			"sha256:ee1a3b20498ee0f20655215821aceb97a45ac3a0b13bfb811fe8c65a690b823c",
		"x86_64-unknown-linux-gnu":
			"sha256:d41a894b08652f614f50ee0e663fe8570e507d63bc293a75e79c52284c83d1fa",
		"x86_64-unknown-linux-musl":
			"sha256:63672e1874978c823939b9ecd9050d878abd068f52a6ecf5a5c7d0ed46be0006",
	};
	const checksum = checksums[target];
	tg.assert(checksum);
	return await tg
		.download(url, checksum, { mode: "extract" })
		.then(tg.Directory.expect);
};

type PrebuiltArg = {
	host?: string;
};

export const prebuilt = async (arg?: PrebuiltArg) => {
	const { host: host_ } = arg ?? {};
	const { version } = metadata;
	const host = host_ ?? (await std.triple.host());

	const arch = std.triple.arch(host);
	const os = std.triple.os(host);

	// The upstream does not provide x86_64-darwin builds.
	if (arch === "x86_64" && os === "darwin") {
		throw new Error(
			"Prebuilt LLVM binaries are not available for x86_64-darwin",
		);
	}

	const checksums: Record<string, tg.Checksum> = {
		["aarch64-linux"]:
			"sha256:b855cc17d935fdd83da82206b7a7cfc680095efd1e9e8182c4a05e761958bef8",
		["x86_64-linux"]:
			"sha256:1ead36b3dfcb774b57be530df42bec70ab2d239fbce9889447c7a29a4ddc1ae6",
		["aarch64-darwin"]:
			"sha256:a9a22f450d35f1f73cd61ab6a17c6f27d8f6051d56197395c1eb397f0c9bbec4",
	};
	const archAndOs = `${arch}-${os}`;
	const checksum = checksums[archAndOs];
	tg.assert(checksum, `unable to locate checksum for ${archAndOs}`);

	const filenameArch = arch === "aarch64" ? "ARM64" : "X64";
	const filenameOs = os === "darwin" ? "macOS" : "Linux";

	const url = `https://github.com/llvm/llvm-project/releases/download/llvmorg-${version}/LLVM-${version}-${filenameOs}-${filenameArch}.tar.xz`;

	let output = await std
		.download({ url, checksum, mode: "extract" })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);

	const buildToolchain = await std.sdk({ host });

	// Add libc.
	const m4ForBuild = dependencies.m4.build({ host, env: buildToolchain });
	const bisonForBuild = dependencies.bison.build({
		host,
		env: std.env.arg(buildToolchain, m4ForBuild),
	});
	const pythonForBuild = dependencies.python.build({
		host,
		env: buildToolchain,
	});
	const sysroot = await constructSysroot({
		env: std.env.arg(bisonForBuild, m4ForBuild, pythonForBuild, {
			utils: false,
		}),
		host,
	})
		.then((dir) => dir.get(host))
		.then(tg.Directory.expect);

	// The precompiled components link against libatomic.so.1 instead of compiler-rt for atomics. Include host's libatomic.so.1 in sysroot.
	const hostGcc = await gnu.toolchain({ host });
	const libAtomic = await hostGcc
		.get("lib/libatomic.so.1")
		.then(tg.File.expect);

	// Add sysroot, cfg, and symlinks.
	output = await tg.directory(output, sysroot, {
		"bin/ar": tg.symlink("llvm-ar"),
		"bin/cc": tg.symlink("clang"),
		"bin/c++": tg.symlink("clang++"),
		"bin/nm": tg.symlink("llvm-nm"),
		"bin/objcopy": tg.symlink("llvm-objcopy"),
		"bin/objdump": tg.symlink("llvm-objdump"),
		"bin/ranlib": tg.symlink("llvm-ar"),
		"bin/readelf": tg.symlink("llvm-readobj"),
		"bin/strings": tg.symlink("llvm-strings"),
		"bin/strip": tg.symlink("llvm-strip"),
		"lib/libatomic.so.1": libAtomic,
	});

	// Collect library paths.
	const zlibLibDir = dependencies.zlib
		.build({ host, env: buildToolchain })
		.then((d) => d.get("lib"))
		.then(tg.Directory.expect);
	const libxmlLibDir = dependencies.libxml2
		.build({
			host,
			env: std.env.arg(buildToolchain, pythonForBuild, { utils: false }),
		})
		.then((d) => d.get("lib"))
		.then(tg.Directory.expect);
	const xzLibDir = utils.xz
		.build({ host, env: buildToolchain })
		.then((d) => d.get("lib"))
		.then(tg.Directory.expect);
	const libraryPaths = [libxmlLibDir, xzLibDir, zlibLibDir];

	// Wrap binaries.
	const binDir = await output.get("bin").then(tg.Directory.expect);
	for await (let [name, file] of binDir) {
		// If the file is an executable with an interpreter, wrap it.
		if (file instanceof tg.File) {
			try {
				const metadata = await std.file.executableMetadata(file);
				if (metadata.format === "elf" && metadata.interpreter !== undefined) {
					const wrapped = await std.wrap(file, {
						libraryPaths,
					});
					output = await tg.directory(output, {
						[`bin/${name}`]: wrapped,
					});
				}
			} catch (_) {}
		}
	}

	// Add shell wrappers for clang and clang++ that use parameter expansion to avoid dirname.
	const bins = ["clang", "clang++"];
	for (const bin of bins) {
		// FIXME - use std.wrap, not shell wrapper ?
		output = await tg.directory(output, {
			[`bin/${bin}`]: tg.file(
				`#!/bin/sh\nexec "clang-20" --sysroot "\${0%/*}/.." -rtlib=compiler-rt "$@"`,
				{ executable: true },
			),
		});
	}

	return output;
};

export const test = async () => {
	// Build a triple for the detected host.
	const host = std.sdk.canonicalTriple(await std.triple.host());
	const hostArch = std.triple.arch(host);
	const system = std.triple.archAndOs(host);
	const os = std.triple.os(system);

	const expectedInterpreterName =
		os === "darwin" ? undefined : libc.interpreterName(host);

	const directory = await toolchain({ host });
	tg.Directory.assert(directory);
	await directory.store();
	console.log("toolchain dir", directory.id);

	const testCSource = tg.file`
		#include <stdio.h>
		int main() {
			printf("Hello, world!\\n");
			return 0;
		}`;
	const cOut = await $`
		set -x && clang -v -xc ${testCSource} -fuse-ld=lld -o $OUTPUT
	`
		.env(directory)
		.host(system)
		.then(tg.File.expect);

	const cMetadata = await std.file.executableMetadata(cOut);
	if (os === "linux") {
		tg.assert(
			cMetadata.format === "elf",
			`expected elf, got ${cMetadata.format}`,
		);
		tg.assert(
			expectedInterpreterName !== undefined
				? cMetadata.interpreter?.includes(expectedInterpreterName)
				: cMetadata.interpreter === undefined,
			`expected ${expectedInterpreterName}, got ${cMetadata.interpreter}`,
		);
		tg.assert(
			cMetadata.arch === hostArch,
			`expected ${hostArch}, got ${cMetadata.arch}`,
		);
	} else if (os === "darwin") {
		tg.assert(
			cMetadata.format === "mach-o",
			`expected mach-o, got ${cMetadata.format}`,
		);
	}

	const testCXXSource = tg.file`
		#include <iostream>
		int main() {
			std::cout << "Hello, world!" << std::endl;
			return 0;
		}
	`;
	const cxxOut = await $`
		set -x && clang++ -v -xc++ ${testCXXSource} -stdlib=libc++ -lc++ -fuse-ld=lld -unwindlib=libunwind -o $OUTPUT
	`
		.env(directory)
		.host(system)
		.then(tg.File.expect);

	const cxxMetadata = await std.file.executableMetadata(cxxOut);
	if (os === "linux") {
		tg.assert(
			cxxMetadata.format === "elf",
			`expected elf, got ${cxxMetadata.format}`,
		);
		tg.assert(
			expectedInterpreterName !== undefined
				? cxxMetadata.interpreter?.includes(expectedInterpreterName)
				: cxxMetadata.interpreter === undefined,
			`expected ${expectedInterpreterName}, got ${cxxMetadata.interpreter}`,
		);
		tg.assert(
			cxxMetadata.arch === hostArch,
			`expected ${hostArch}, got ${cxxMetadata.arch}`,
		);
	} else if (os === "darwin") {
		tg.assert(
			cxxMetadata.format === "mach-o",
			`expected mach-o, got ${cxxMetadata.format}`,
		);
	}

	return directory;
};
