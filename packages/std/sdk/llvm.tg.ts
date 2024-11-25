import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.ts";
import { $ } from "../tangram.ts";
import * as cmake from "./cmake.tg.ts";
import * as dependencies from "./dependencies.tg.ts";
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
	version: "19.1.4",
};

export const source = tg.target(async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:3aa2d2d2c7553164ad5c6f3b932b31816e422635e18620c9349a7da95b98d811";
	const owner = name;
	const repo = "llvm-project";
	const tag = `llvmorg-${version}`;
	const extension = ".tar.xz";
	const url = `https://github.com/${owner}/${repo}/releases/download/${tag}/${repo}-${version}.src${extension}`;
	return std
		.download({ checksum, url })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

export type LLVMArg = {
	build?: string;
	env?: std.env.Arg;
	host?: string;
	lto?: boolean;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

/** Produce a complete clang+lld distribution using a 2-stage bootstrapping build. */
export const toolchain = tg.target(async (arg?: LLVMArg) => {
	const {
		build: build_,
		env: env_,
		host: host_,
		lto = true,
		sdk,
		source: source_,
	} = arg ?? {};
	const host = std.sdk.canonicalTriple(host_ ?? (await std.triple.host()));
	const build = build_ ?? host;

	if (std.triple.os(host) === "darwin") {
		// On macOS, just return the bootstrap toolchain, which provides Apple Clang.
		return bootstrap.sdk.env(host);
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
		env: std.env.arg(m4ForBuild, bisonForBuild)
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
		env: std.env.arg(bisonForBuild, m4ForBuild, pythonForBuild),
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
		env: std.env.arg(env),
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
	const ncursesLibDir = ncursesArtifact.then((dir) =>
		dir.get("lib").then(tg.Directory.expect),
	);
	const zlibLibDir = zlibArtifact.then((dir) =>
		dir.get("lib").then(tg.Directory.expect),
	);
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
});

/** Grab the LLD linker from the toolchain. */
export const lld = tg.target(async (arg?: LLVMArg) => {
	const toolchainDir = await toolchain(arg);
	tg.assert(toolchainDir instanceof tg.Directory);
	// Use a template instead of the file directly so the linker proxy invokes the linker by its full name.
	return tg`${toolchainDir}/bin/ld.lld`;
});

type LinuxToDarwinArg = {
	host: string;
	target?: string;
};

/** Produce a linux to darwin toolchain. */
import testSource from "../wrap/test/inspectProcess.c" with { type: "file" };
export const linuxToDarwin = tg.target(async (arg?: LinuxToDarwinArg) => {
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
	return await std.env.arg(clangToolchain, cctoolsForTarget);
});

export const testLinuxToDarwin = tg.target(async (arg?: LinuxToDarwinArg) => {
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
});

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
	if (std.triple.os(host) === "darwin") {
		// Note - the Apple Clang version provided by the OS is 16, not ${version}.
		clangArgs.push(tg`-resource-dir=${toolchainDir}/lib/clang/16.0.0`);
		clangxxArgs = [...clangArgs];
		env = {
			SDKROOT: tg.Mutation.setIfUnset(bootstrap.macOsSdk()),
		};
	} else {
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
	}

	return { clangArgs, clangxxArgs, env };
};

export const test = async () => {
	// Build a triple for the detected host.
	const host = std.sdk.canonicalTriple(await std.triple.host());
	const hostArch = std.triple.arch(host);
	const system = std.triple.archAndOs(host);
	const os = std.triple.os(system);

	const expectedInterpreter =
		os === "darwin" ? undefined : `/lib/${libc.interpreterName(host)}`;

	const directory = await toolchain({ host });
	tg.Directory.assert(directory);
	console.log("toolchain dir", await directory.id());

	const testCSource = tg.file(`
		#include <stdio.h>
		int main() {
			printf("Hello, world!\\n");
			return 0;
		}
	`);
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

	const testCXXSource = tg.file(`
		#include <iostream>
		int main() {
			std::cout << "Hello, world!" << std::endl;
			return 0;
		}
	`);
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
