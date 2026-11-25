import * as std from "std" with { source: "../std" };
import { $ } from "std" with { source: "../std" };
import * as cmake from "cmake" with { source: "../cmake" };
import git from "git" with { source: "../git.tg.ts" };
import ncurses from "ncurses" with { source: "../ncurses.tg.ts" };
import python from "python" with { source: "../python" };
import zlibNg from "zlib-ng" with { source: "../zlib-ng.tg.ts" };
import * as glibc from "glibc" with { source: "../glibc.tg.ts" };
import cmakeCacheDir from "./cmake" with { type: "directory" };

export const metadata = {
	builds: { exports: ["default", "libclang"] },
	homepage: "https://llvm.org/",
	name: "llvm",
	license:
		"https://github.com/llvm/llvm-project/blob/llvmorg-23.1.6/LICENSE.TXT",
	repository: "https://github.com/llvm/llvm-project/",
	version: "23.1.6",
	tag: "llvm/23.1.6",
};

export async function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:d3b86ab29cfb4445a6652e5c2642ccc75e04e38084dde3701d323320f35a31da";
	const owner = name;
	const repo = "llvm-project";
	const tag = `llvmorg-${version}`;
	const extension = ".tar.xz";
	const url = `https://github.com/${owner}/${repo}/releases/download/${tag}/${repo}-${version}.src${extension}`;
	return std.download
		.extractArchive({ checksum, url })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
}

export type LLVMArg = {
	build?: string;
	env?: std.env.Arg;
	host?: string;
	lto?: boolean;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

/** Produce a complete clang+lld distribution using a 2-stage bootstrapping build. */
export async function toolchain(arg?: LLVMArg) {
	const {
		build: build_,
		env: env_,
		host: host_,
		lto = true,
		sdk,
		source: source_,
	} = arg ?? {};
	const host = std.sdk.canonicalTriple(host_ ?? std.triple.host());
	const build = build_ ?? host;

	const sourceDir = source_ ?? source();

	// Define build environment.
	const pythonForBuild = await python();
	const ncursesArtifact = await ncurses();
	const zlibNgArtifact = await zlibNg();
	const deps = [git(), pythonForBuild, ncursesArtifact, zlibNgArtifact];

	// Obtain a sysroot for the requested host.
	const sysroot = await glibc
		.sysroot({ host })
		.then((d) => d.get(host))
		.then(tg.Directory.expect);

	const env = await std.env.compose(...deps, env_ ?? null);

	const ldsoName = glibc.interpreterName(host);
	// Ensure that stage2 unproxied binaries are runnable during the build, before we have a chance to wrap them post-install.
	// FIXME - get the gcc version programatically.
	// const stage2ExeLinkerFlags = tg`-Wl,-dynamic-linker=${sysroot}/lib/${ldsoName} -L$\{SYSROOT_LIBDIR\}/gcc/$\{HOST_GCC_TRIPLE\}/15.1.0 -B$\{SYSROOT_LIBDIR\}/gcc/$\{HOST_GCC_TRIPLE\}/15.1.0 -B$\{SYSROOT_LIBDIR\} -L\{SYSROOT_LIBDIR\}`;
	const stage2ExeLinkerFlags = tg`-Wl,-dynamic-linker=${sysroot}/lib/${ldsoName} -unwindlib=libunwind`;

	// Ensure that stage2 unproxied binaries are able to locate libraries during the build, without hardcoding rpaths. We'll wrap them afterwards.
	const prepare = tg`set -x && export HOME=$PWD && export LD_LIBRARY_PATH="${sysroot}/lib:${zlibNgArtifact}/lib:$HOME/build/lib:$HOME/build/lib/${host}"`;

	// Define default flags.
	const configure = {
		args: [
			tg`-DBOOTSTRAP_CMAKE_EXE_LINKER_FLAGS='${stage2ExeLinkerFlags}'`,
			tg`-DDEFAULT_SYSROOT=${sysroot}`,
			`-DLLVM_HOST_TRIPLE=${host}`,
			`-DTANGRAM_HOST_TRIPLE=${host}`,
			"-DLLVM_PARALLEL_LINK_JOBS=1",
			tg`-DZLIB_ROOT=${zlibNgArtifact}`,
			`-DCLANG_BOOTSTRAP_PASSTHROUGH="DEFAULT_SYSROOT;LLVM_PARALLEL_LINK_JOBS;ZLIB_ROOT;TANGRAM_HOST_TRIPLE"`,
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

	const buildPhase = "cd build && ninja stage2-distribution";
	const install = "ninja stage2-install-distribution";
	const phases = { prepare, configure, build: buildPhase, install };

	// Bound the build's hardware threads, which bounds its concurrent C++ compilations, and reserve memory for them, so that the build fits on a machine with many threads and little memory.
	let llvmArtifact = await cmake.build({
		host: build,
		target: host,
		cpu: 4,
		env,
		memory: { min: 4 * 1024 ** 3 },
		phases,
		...std.args.optional("sdk", sdk),
		source: tg`${sourceDir}/llvm`,
	});

	// Merge zlib-ng libraries into the artifact so $ORIGIN-based RPATH can find them.
	const zlibLibDir = await tg.Directory.expect(zlibNgArtifact)
		.get("lib")
		.then(tg.Directory.expect);

	// Add sysroot, zlib libs, and symlinks.
	llvmArtifact = await tg.directory(llvmArtifact, sysroot, {
		lib: zlibLibDir,
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
	// With $ORIGIN-based RPATH embedded during build, binaries can find libraries
	// relative to their location. We still wrap to ensure the interpreter is correct.

	// Collect library paths for non-clang binaries that may not have RPATH set.
	const libDir = llvmArtifact.get("lib").then(tg.Directory.expect);
	const hostLibDir = libDir.then((d) => d.get(host)).then(tg.Directory.expect);
	const libraryPaths = [libDir, hostLibDir];

	// Wrap all ELF binaries in the bin directory, except clang-XX which must not be
	// wrapped to preserve /proc/self/exe for the -cc1 driver.
	const majorVersion = llvmMajorVersion();
	const clangBinaryName = `clang-${majorVersion}`;
	const binDir = await llvmArtifact.get("bin").then(tg.Directory.expect);
	for await (const [name, artifact] of binDir) {
		if (artifact instanceof tg.File && name !== clangBinaryName) {
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

	// Replace clang and clang++ with shell scripts that exec the unwrapped clang binary.
	// This allows the toolchain to work correctly since /proc/self/exe will point to the
	// real clang binary, enabling it to find its resource directory.
	llvmArtifact = await tg.directory(llvmArtifact, {
		"bin/clang": tg.file(`#!/bin/sh\nexec ${clangBinaryName} "$@"\n`, {
			executable: true,
		}),
		"bin/clang++": tg.file(`#!/bin/sh\nexec ${clangBinaryName} "$@"\n`, {
			executable: true,
		}),
	});

	return llvmArtifact;
}

export default toolchain;

/** Build libclang only. */
export async function libclang(arg?: LLVMArg) {
	const {
		build: build_,
		env: env_,
		host: host_,
		sdk,
		source: source_,
	} = arg ?? {};
	const host = host_ ?? std.triple.host();
	const build = build_ ?? host;

	const sourceDir = source_ ?? source();

	// Define build environment.
	const pythonForBuild = await python();
	const zlibNgArtifact = await zlibNg();
	const deps = [git(), pythonForBuild, zlibNgArtifact];

	const env = await std.env.arg(...deps, env_ ?? null);

	// Define default flags.
	const configure = {
		args: [
			"-DCMAKE_BUILD_TYPE=Release",
			"-DLLVM_ENABLE_PROJECTS=clang",
			`-DLLVM_HOST_TRIPLE=${host}`,
			"-DLLVM_PARALLEL_LINK_JOBS=1",
			tg`-DZLIB_ROOT=${zlibNgArtifact}`,
		],
	};
	// Without the resource headers, such as `stdbool.h`, libclang cannot parse most translation units.
	const buildPhase = {
		pre: "cd build",
		body: "ninja libclang clang-resource-headers",
	};
	const install = "ninja install-libclang install-clang-resource-headers";
	const phases = { configure, build: buildPhase, install };

	// Bound the build's hardware threads, which bounds its concurrent C++ compilations, and reserve memory for them, so that the build fits on a machine with many threads and little memory.
	const libclangArtifact = await cmake.build({
		...(await std.triple.rotate({ build, host })),
		cpu: 4,
		env,
		memory: { min: 4 * 1024 ** 3 },
		phases,
		...std.args.optional("sdk", sdk),
		source: tg`${sourceDir}/llvm`,
	});

	const zlibLibDir = await zlibNgArtifact.get("lib").then(tg.Directory.expect);
	return await tg.directory(libclangArtifact, { lib: zlibLibDir });
}

/** Build LLD only, without the 2-stage bootstrap. */
export async function lld(arg?: LLVMArg) {
	const {
		build: build_,
		env: env_,
		host: host_,
		lto = true,
		sdk,
		source: source_,
	} = arg ?? {};
	const host = host_ ?? std.triple.host();
	const build = build_ ?? host;

	const sourceDir = source_ ?? source();

	// Define build environment.
	const pythonForBuild = await python();
	const zlibNgArtifact = await zlibNg();
	const deps = [git(), pythonForBuild, zlibNgArtifact];

	const env = await std.env.arg(...deps, env_ ?? null);

	// Define default flags.
	const configure = {
		args: [
			"-DCMAKE_BUILD_TYPE=Release",
			"-DLLVM_ENABLE_PROJECTS=lld",
			`-DLLVM_HOST_TRIPLE=${host}`,
			"-DLLVM_PARALLEL_LINK_JOBS=1",
			tg`-DZLIB_ROOT=${zlibNgArtifact}`,
		],
	};

	const phases = { configure };

	// Bound the build's hardware threads, which bounds its concurrent C++ compilations, and reserve memory for them, so that the build fits on a machine with many threads and little memory.
	return await cmake.build({
		...(await std.triple.rotate({ build, host })),
		cpu: 4,
		env,
		memory: { min: 4 * 1024 ** 3 },
		phases,
		...std.args.optional("sdk", sdk),
		source: tg`${sourceDir}/llvm`,
	});
}

export function llvmMajorVersion() {
	return metadata.version.split(".")[0];
}

type WrapArgsArg = {
	host: string;
	target?: string;
	toolchainDir: tg.Directory;
};

/** Produce the flags and environment required to properly proxy this toolchain. */
export async function wrapArgs(arg: WrapArgsArg) {
	const { host, target: target_, toolchainDir } = arg;
	const target = target_ ?? host;
	const version = llvmMajorVersion();

	let clangArgs: tg.Unresolved<Array<tg.Template.Arg>> = [];
	let clangxxArgs: tg.Unresolved<Array<tg.Template.Arg>> = [];
	let env = {};
	// If the target is darwin, set sysroot and target flags.

	// Define common flags.
	const commonFlags = [
		tg`-resource-dir=${toolchainDir}/lib/clang/${version ?? null}`,
		tg`-L${toolchainDir}/lib/${target}`,
	];

	// Set C flags.
	clangArgs = clangArgs.concat(commonFlags);

	// Set C++ flags.
	const cxxFlags = [
		"-unwindlib=libunwind",
		tg`-isystem${toolchainDir}/include/c++/v1`,
		tg`-isystem${toolchainDir}/include/${target}/c++/v1`,
	];
	clangxxArgs = clangxxArgs.concat(commonFlags, cxxFlags);

	return { clangArgs, clangxxArgs, env };
}

export async function test() {
	// Build a triple for the detected host.
	const host = std.sdk.canonicalTriple(std.triple.host());
	const hostArch = std.triple.arch(host);
	const system = std.triple.archAndOs(host);
	const os = std.triple.os(system);

	const expectedInterpreterName =
		os === "darwin" ? undefined : glibc.interpreterName(host);

	const directory = await toolchain({ host });
	tg.Directory.assert(directory);
	console.log("toolchain dir", directory.id);

	const testCSource = tg.file`
		#include <stdio.h>
		int main() {
			printf("Hello, world!\\n");
			return 0;
		}`;
	const cOut = await $(std.shBootstrap`
		set -x && clang -v -xc ${testCSource} -fuse-ld=lld -o ${tg.output}
	`)
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
	const cxxOut = await $(std.shBootstrap`
		set -x && clang++ -v -xc++ ${testCXXSource} -stdlib=libc++ -lc++ -fuse-ld=lld -unwindlib=libunwind -o ${tg.output}
	`)
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
	} else if (os === "darwin") {
		tg.assert(
			cxxMetadata.format === "mach-o",
			`expected mach-o, got ${cxxMetadata.format}`,
		);
	}

	return directory;
}
