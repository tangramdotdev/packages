import * as std from "std" with { path: "../std" };
import { $ } from "std" with { path: "../std" };
import * as cmake from "cmake" with { path: "../cmake" };
import git from "git" with { path: "../git" };
import ncurses from "ncurses" with { path: "../ncurses" };
import python from "python" with { path: "../python" };
import zlib from "zlib" with { path: "../zlib" };
import * as glibc from "glibc" with { path: "../glibc" };
import cmakeCacheDir from "./cmake" with { type: "directory" };

export const metadata = {
	homepage: "https://llvm.org/",
	name: "llvm",
	license:
		"https://github.com/llvm/llvm-project/blob/991cfd1379f7d5184a3f6306ac10cabec742bbd2/LICENSE.TXT",
	repository: "https://github.com/llvm/llvm-project/",
	version: "20.1.7",
};

export const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:cd8fd55d97ad3e360b1d5aaf98388d1f70dfffb7df36beee478be3b839ff9008";
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
	const host = host_ ?? (await std.triple.host());
	const build = build_ ?? host;

	const sourceDir = source_ ?? source();

	// Define build environment.
	const pythonForBuild = await python();
	const ncursesArtifact = await ncurses();
	const zlibArtifact = await zlib();
	const deps = [git(), pythonForBuild, ncursesArtifact, zlibArtifact];

	// Obtain a sysroot for the requested host.
	// TODO - host
	const sysroot = await glibc
		.sysroot()
		.then((d) => d.get(host))
		.then(tg.Directory.expect);

	const env = await std.env.arg(...deps, env_);

	const ldsoName = glibc.interpreterName(host);
	// Ensure that stage2 unproxied binaries are runnable during the build, before we have a chance to wrap them post-install.
	const stage2ExeLinkerFlags = tg`-Wl,-dynamic-linker=${sysroot}/lib/${ldsoName} -unwindlib=libunwind`;

	// Ensure that stage2 unproxied binaries are able to locate libraries during the build, without hardcoding rpaths. We'll wrap them afterwards.
	const prepare = tg`export LD_LIBRARY_PATH="${sysroot}/lib:${zlibArtifact}/lib:${ncursesArtifact}/lib:/work/lib:/work/lib/${host}"`;

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
		pre: "cd /build",
		body: {
			command: "ninja",
			args: tg.Mutation.set(["stage2-distribution"]),
		},
	};
	const install = {
		command: "ninja",
		args: tg.Mutation.set(["stage2-install-distribution"]),
	};
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

	// Collect all required library paths.
	const libDir = llvmArtifact.get("lib").then(tg.Directory.expect);
	const hostLibDir = tg.symlink(tg`${libDir}/${host}`);
	const ncursesLibDir = ncursesArtifact.get("lib").then(tg.Directory.expect);
	const zlibLibDir = zlibArtifact.get("lib").then(tg.Directory.expect);
	const libraryPaths = [libDir, hostLibDir, ncursesLibDir, zlibLibDir];

	// Wrap all ELF binaries in the bin directory.
	const binDir = await llvmArtifact.get("bin").then(tg.Directory.expect);
	for await (const [name, artifact] of binDir) {
		if (artifact instanceof tg.File) {
			const { format } = await std.file.executableMetadata(artifact);
			if (format === "elf") {
				const unwrapped = binDir.get(name).then(tg.File.expect);
				// Use the wrapper identity to ensure the wrapper is called when binaries call themselves. Otherwise it won't find all required libraries.
				const wrapped = std.wrap(unwrapped, {
					identity: "wrapper",
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

export default toolchain;

/** Build libclang only. */
export const libclang = async (arg?: LLVMArg) => {
	const {
		build: build_,
		env: env_,
		host: host_,
		sdk,
		source: source_,
	} = arg ?? {};
	const host = host_ ?? (await std.triple.host());
	const build = build_ ?? host;

	const sourceDir = source_ ?? source();

	// Define build environment.
	const pythonForBuild = await python();
	const deps = [pythonForBuild];

	const env = await std.env.arg(...deps, env_);

	// Define default flags.
	const configure = {
		args: [
			"-DCMAKE_BUILD_TYPE=Release",
			"-DLLVM_ENABLE_PROJECTS=clang",
			`-DLLVM_HOST_TRIPLE=${host}`,
			"-DLLVM_PARALLEL_LINK_JOBS=1",
		],
	};
	const buildPhase = {
		pre: "cd /build",
		body: {
			command: "ninja",
			args: tg.Mutation.set(["libclang"]),
		},
	};
	const install = {
		command: "ninja",
		args: tg.Mutation.set(["install-libclang"]),
	};
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
	const host = host_ ?? (await std.triple.host());
	const build = build_ ?? host;

	const sourceDir = source_ ?? source();

	// Define build environment.
	const pythonForBuild = await python();
	const zlibArtifact = await zlib();
	const deps = [git(), pythonForBuild, zlibArtifact];

	const env = await std.env.arg(...deps, env_);

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
	const host = std.sdk.canonicalTriple(await std.triple.host());
	const hostArch = std.triple.arch(host);
	const system = std.triple.archAndOs(host);
	const os = std.triple.os(system);

	const expectedInterpreter =
		os === "darwin" ? undefined : `/lib/${glibc.interpreterName(host)}`;

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
			cMetadata.interpreter === expectedInterpreter,
			`expected ${expectedInterpreter}, got ${cMetadata.interpreter}`,
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
		set -x && clang++ -v -xc++ ${testCXXSource} -fuse-ld=lld -unwindlib=libunwind -o $OUTPUT
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
			cxxMetadata.interpreter === expectedInterpreter,
			`expected ${expectedInterpreter}, got ${cxxMetadata.interpreter}`,
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
