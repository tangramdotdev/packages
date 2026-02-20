import * as std from "std" with { local: "../std" };
import { $ } from "std" with { local: "../std" };
import * as cmake from "cmake" with { local: "../cmake" };
import git from "git" with { local: "../git.tg.ts" };
import ncurses from "ncurses" with { local: "../ncurses.tg.ts" };
import python from "python" with { local: "../python" };
import zlibNg from "zlib-ng" with { local: "../zlib-ng.tg.ts" };
import * as glibc from "glibc" with { local: "../glibc.tg.ts" };
import cmakeCacheDir from "./cmake" with { type: "directory" };

export const metadata = {
	homepage: "https://llvm.org/",
	name: "llvm",
	license:
		"https://github.com/llvm/llvm-project/blob/991cfd1379f7d5184a3f6306ac10cabec742bbd2/LICENSE.TXT",
	repository: "https://github.com/llvm/llvm-project/",
	version: "21.1.8",
	tag: "llvm/21.1.8",
};

export const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:4633a23617fa31a3ea51242586ea7fb1da7140e426bd62fc164261fe036aa142";
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
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

/** Produce a complete clang+lld distribution using a 2-stage bootstrapping build. */
export const toolchain = async (arg?: LLVMArg) => {
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
	const ncursesArtifact = await ncurses();
	const zlibNgArtifact = await zlibNg();
	const deps = [git(), pythonForBuild, ncursesArtifact, zlibNgArtifact];

	// Obtain a sysroot for the requested host.
	const sysroot = await glibc
		.sysroot({ host })
		.then((d) => d.get(host))
		.then(tg.Directory.expect);

	const env = await std.env.arg(
		...deps,
		{
			CFLAGS: tg.Mutation.suffix("-Wno-unused-command-line-argument", " "),
		},
		env_,
	);

	const ldsoName = glibc.interpreterName(host);
	// Ensure that stage2 unproxied binaries are runnable during the build, before we have a chance to wrap them post-install.
	// FIXME - get the gcc version programatically.
	// const stage2ExeLinkerFlags = tg`-Wl,-dynamic-linker=${sysroot}/lib/${ldsoName} -L$\{SYSROOT_LIBDIR\}/gcc/$\{HOST_GCC_TRIPLE\}/15.1.0 -B$\{SYSROOT_LIBDIR\}/gcc/$\{HOST_GCC_TRIPLE\}/15.1.0 -B$\{SYSROOT_LIBDIR\} -L\{SYSROOT_LIBDIR\}`;
	const stage2ExeLinkerFlags = tg`-Wl,-dynamic-linker=${sysroot}/lib/${ldsoName} -unwindlib=libunwind`;

	// Ensure that stage2 unproxied binaries are able to locate libraries during the build, without hardcoding rpaths. We'll wrap them afterwards.
	const prepare = tg`set -x && export HOME=$PWD && export LD_LIBRARY_PATH="${sysroot}/lib:${zlibNgArtifact}/lib:${ncursesArtifact}/lib:$HOME/build/lib:$HOME/build/lib/${host}"`;

	// Define default flags.
	const configure = {
		args: [
			tg`-DBOOTSTRAP_CMAKE_EXE_LINKER_FLAGS='${stage2ExeLinkerFlags}'`,
			tg`-DDEFAULT_SYSROOT=${sysroot}`,
			`-DLLVM_HOST_TRIPLE=${host}`,
			"-DLLVM_PARALLEL_LINK_JOBS=1",
			tg`-DTerminfo_ROOT=${ncursesArtifact}`,
			tg`-DBOOTSTRAP_Terminfo_ROOT=${ncursesArtifact}`,
			tg`-DZLIB_ROOT=${zlibNgArtifact}`,
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

	const buildPhase = "cd build && ninja stage2-distribution";
	const install = "ninja stage2-install-distribution";
	const phases = { prepare, configure, build: buildPhase, install };

	let llvmArtifact = await cmake.build({
		...(await std.triple.rotate({ build, host })),
		env,
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
	// With the sysroot embedded, binaries can find libraries relative to their location.
	// We still wrap to ensure the interpreter is correct.

	// Collect all required library paths.
	const libDir = llvmArtifact.get("lib").then(tg.Directory.expect);
	const hostLibDir = libDir.then((d) => d.get(host)).then(tg.Directory.expect);
	const ncursesLibDir = ncursesArtifact.get("lib").then(tg.Directory.expect);
	const zlibLibDir = zlibNgArtifact.get("lib").then(tg.Directory.expect);
	const libraryPaths = [libDir, hostLibDir, ncursesLibDir, zlibLibDir];

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
};

export default toolchain;

type PrebuiltArg = {
	host?: string;
};

export const prebuilt = async (arg?: PrebuiltArg) => {
	const { host: host_ } = arg ?? {};
	const { version } = metadata;
	const host = host_ ?? std.triple.host();

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

	// On Linux, we have to wrap.
	const binDir = await output.get("bin").then(tg.Directory.expect);
	for await (let [name, file] of binDir) {
		// If the file is an executable with an interpreter, wrap it.
		if (file instanceof tg.File) {
			const metadata = await std.file.executableMetadata(file);
			if (metadata.format === "elf" && metadata.interpreter !== undefined) {
				const wrapped = await std.wrap(file);
				output = await tg.directory(output, {
					[`bin/${name}`]: wrapped,
				});
			}
		}
	}

	return output;
};

/** Build libclang only. */
export const libclang = async (arg?: LLVMArg) => {
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

	const env = await std.env.arg(...deps, env_);

	// Define default flags.
	const configure = {
		args: [
			"-DCMAKE_BUILD_TYPE=Release",
			"-DCMAKE_SKIP_INSTALL_RPATH=On",
			"-DLLVM_ENABLE_PROJECTS=clang",
			`-DLLVM_HOST_TRIPLE=${host}`,
			"-DLLVM_PARALLEL_LINK_JOBS=1",
			tg`-DZLIB_ROOT=${zlibNgArtifact}`,
		],
	};
	const buildPhase = {
		pre: "cd build",
		body: "ninja libclang",
	};
	const install = "ninja install-libclang";
	const phases = { configure, build: buildPhase, install };

	return await cmake.build({
		...(await std.triple.rotate({ build, host })),
		env,
		phases,
		sdk,
		source: tg`${sourceDir}/llvm`,
	});
};

/** Build LLD only, without the 2-stage bootstrap. */
export const lld = async (arg?: LLVMArg) => {
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

	const env = await std.env.arg(...deps, env_);

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

	return await cmake.build({
		...(await std.triple.rotate({ build, host })),
		env,
		phases,
		sdk,
		source: tg`${sourceDir}/llvm`,
	});
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
	const version = llvmMajorVersion();

	let clangArgs: tg.Unresolved<Array<tg.Template.Arg>> = [];
	let clangxxArgs: tg.Unresolved<Array<tg.Template.Arg>> = [];
	let env = {};
	// If the target is darwin, set sysroot and target flags.

	// Define common flags.
	const commonFlags = [
		tg`-resource-dir=${toolchainDir}/lib/clang/${version}`,
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
};

export const test = async () => {
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
	const cOut = await $`
		set -x && clang -v -xc ${testCSource} -fuse-ld=lld -o ${tg.output}
	`
		.bootstrap(true)
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
	const cxxOut = await $`
		set -x && clang++ -v -xc++ ${testCXXSource} -stdlib=libc++ -lc++ -fuse-ld=lld -unwindlib=libunwind -o ${tg.output}
	`
		.bootstrap(true)
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
};
