import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.tg.ts";
import { $ } from "../tangram.tg.ts";
import * as cmake from "./cmake.tg.ts";
import * as dependencies from "./dependencies.tg.ts";
import git from "./llvm/git.tg.ts";
import * as libc from "./libc.tg.ts";
import ncurses from "./llvm/ncurses.tg.ts";
import cctools from "./llvm/cctools_port.tg.ts";
import {
	buildToHostCrossToolchain,
	buildToolsForHost,
} from "./gcc/toolchain.tg.ts";
import cmakeCacheDir from "./llvm/cmake" with { type: "directory" };

export let metadata = {
	homepage: "https://llvm.org/",
	name: "llvm",
	license:
		"https://github.com/llvm/llvm-project/blob/991cfd1379f7d5184a3f6306ac10cabec742bbd2/LICENSE.TXT",
	repository: "https://github.com/llvm/llvm-project/",
	version: "18.1.8",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:0b58557a6d32ceee97c8d533a59b9212d87e0fc4d2833924eb6c611247db2f2a";
	let owner = name;
	let repo = "llvm-project";
	let tag = `llvmorg-${version}`;
	let extension = ".tar.xz";
	let url = `https://github.com/${owner}/${repo}/releases/download/${tag}/${repo}-${version}.src${extension}`;
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
export let toolchain = tg.target(async (arg?: LLVMArg) => {
	let {
		build: build_,
		env: env_,
		host: host_,
		lto = true,
		sdk,
		source: source_,
	} = arg ?? {};
	let host = std.sdk.canonicalTriple(host_ ?? (await std.triple.host()));
	let build = build_ ?? host;

	if (std.triple.os(host) === "darwin") {
		// On macOS, just return the bootstrap toolchain, which provides Apple Clang.

		return bootstrap.sdk.env(host);
	}

	let sourceDir = source_ ?? source();

	// Use the internal GCC bootstrapping function to avoid needlesssly rebuilding glibc.
	let { sysroot } = await buildToHostCrossToolchain({
		host,
		env: await std.env.arg(bootstrap.sdk(), buildToolsForHost({ host })),
	});
	// The buildSysroot helper nests the sysroot under a triple-named directory. Extract the inner dir.
	sysroot = tg.Directory.expect(await sysroot.get(host));

	// Define build environment.
	let ncursesArtifact = ncurses({ host: build });
	let zlibArtifact = dependencies.zlib.build({ host: build });
	let deps = [
		git({ host: build }),
		dependencies.python.build({
			host: build,
			sdk: bootstrap.sdk.arg(build),
		}),
		ncursesArtifact,
		zlibArtifact,
	];

	let env = [...deps, env_];

	let ldsoName = libc.interpreterName(host);
	// Ensure that stage2 unproxied binaries are runnable during the build, before we have a chance to wrap them post-install.
	let stage2ExeLinkerFlags = tg`-Wl,-dynamic-linker=${sysroot}/lib/${ldsoName} -unwindlib=libunwind`;

	// Ensure that stage2 unproxied binaries are able to locate libraries during the build, without hardcoding rpaths. We'll wrap them afterwards.
	let prepare = tg`export LD_LIBRARY_PATH="${sysroot}/lib:${zlibArtifact}/lib:${ncursesArtifact}/lib:$HOME/work/lib:$HOME/work/lib/${host}"`;

	// Define default flags.
	let configure = {
		args: [
			tg`-DBOOTSTRAP_CMAKE_EXE_LINKER_FLAGS='${stage2ExeLinkerFlags}'`,
			tg`-DDEFAULT_SYSROOT=${sysroot}`,
			"-DLLVM_PARALLEL_LINK_JOBS=1",
			tg`-DTerminfo_ROOT=${ncursesArtifact}`,
			// NOTE - CLANG_BOOTSTRAP_PASSTHROUGH didn't work for Terminfo_ROOT, but this did.
			tg`-DBOOTSTRAP_Terminfo_ROOT=${ncursesArtifact}`,
			tg`-DZLIB_ROOT=${zlibArtifact}`,
			`-DCLANG_BOOTSTRAP_PASSTHROUGH="DEFAULT_SYSROOT;LLVM_PARALLEL_LINK_JOBS;ZLIB_ROOT"`,
		],
	};

	// Add additional flags from the target args.
	if (lto) {
		configure.args.push("-DBOOTSTRAP_LLVM_ENABLE_LTO=Thin");
	}

	// Add the cmake cache file last.
	configure.args.push(tg`-C${cmakeCacheDir}/Distribution.cmake`);

	let buildPhase = {
		command: "ninja",
		args: tg.Mutation.set(["stage2-distribution"]),
	};
	let install = {
		command: "ninja",
		args: tg.Mutation.set(["stage2-install-distribution"]),
	};
	let phases = { prepare, configure, build: buildPhase, install };

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
	let libDir = llvmArtifact.get("lib").then(tg.Directory.expect);
	let hostLibDir = tg.symlink(tg`${libDir}/${host}`);
	let ncursesLibDir = ncursesArtifact.then((dir) =>
		dir.get("lib").then(tg.Directory.expect),
	);
	let zlibLibDir = zlibArtifact.then((dir) =>
		dir.get("lib").then(tg.Directory.expect),
	);
	let libraryPaths = [libDir, hostLibDir, ncursesLibDir, zlibLibDir];

	// Wrap all ELF binaries in the bin directory.
	let binDir = await llvmArtifact.get("bin").then(tg.Directory.expect);
	for await (let [name, artifact] of binDir) {
		if (artifact instanceof tg.File) {
			let { format } = await std.file.executableMetadata(artifact);
			if (format === "elf") {
				let unwrapped = binDir.get(name).then(tg.File.expect);
				// Use the wrapper identity to ensure the wrapper is called when binaries call themselves. Otherwise it won't find all required libraries.
				let wrapped = std.wrap(unwrapped, {
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
export let lld = tg.target(async (arg?: LLVMArg) => {
	let toolchainDir = await toolchain(arg);
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
export let linuxToDarwin = tg.target(async (arg: LinuxToDarwinArg) => {
	let { host, target: target_ } = arg;
	let target = target_ ?? host;
	let clangToolchain = await toolchain({ host });
	let cctoolsForTarget = await cctools(std.triple.arch(target));
	let macosSdk = await bootstrap.macOsSdk();
	let combined = await std.env.arg(clangToolchain, cctoolsForTarget);
	let f = await $`
	set -x
	clang --version
	clang -v -xc ${testSource} --sysroot ${macosSdk} -target ${target} -o $OUTPUT
	`
		.env(combined)
		.then(tg.File.expect);
	return f;
});

export let llvmMajorVersion = () => {
	return metadata.version.split(".")[0];
};

type WrapArgsArg = {
	host: string;
	target?: string;
	toolchainDir: tg.Directory;
};

/** Produce the flags and environment required to properly proxy this toolchain. */
export let wrapArgs = async (arg: WrapArgsArg) => {
	let { host, target: target_, toolchainDir } = arg;
	let target = target_ ?? host;
	let version = llvmMajorVersion();

	let clangArgs: tg.Unresolved<Array<tg.Template.Arg>> = [];
	let clangxxArgs: tg.Unresolved<Array<tg.Template.Arg>> = [];
	let env = {};
	if (std.triple.os(host) === "darwin") {
		// Note - the Apple Clang version provided by the OS is 15, not ${version}.
		clangArgs.push(tg`-resource-dir=${toolchainDir}/lib/clang/15.0.0`);
		clangxxArgs = [...clangArgs];
		env = {
			SDKROOT: tg.Mutation.setIfUnset(bootstrap.macOsSdk()),
		};
	} else {
		// Define common flags.
		let commonFlags = [
			tg`-resource-dir=${toolchainDir}/lib/clang/${version}`,
			tg`-L${toolchainDir}/lib/${target}`,
		];

		// Set C flags.
		clangArgs = clangArgs.concat(commonFlags);

		// Set C++ flags.
		let cxxFlags = [
			"-unwindlib=libunwind",
			tg`-isystem${toolchainDir}/include/c++/v1`,
			tg`-isystem${toolchainDir}/include/${target}/c++/v1`,
		];
		clangxxArgs = clangxxArgs.concat(commonFlags, cxxFlags);
	}

	return { clangArgs, clangxxArgs, env };
};

export let test = async () => {
	// Build a triple for the detected host.
	let host = std.sdk.canonicalTriple(await std.triple.host());
	let hostArch = std.triple.arch(host);
	let system = std.triple.archAndOs(host);
	let os = std.triple.os(system);

	let expectedInterpreter =
		os === "darwin" ? undefined : `/lib/${libc.interpreterName(host)}`;

	let directory = await toolchain({ host });

	let testCSource = tg.file(`
		#include <stdio.h>
		int main() {
			printf("Hello, world!\\n");
			return 0;
		}
	`);
	let cOut = await $`
		set -x && clang -v -xc ${testCSource} -fuse-ld=lld -o $OUTPUT
	`
		.env(directory)
		.host(system)
		.then(tg.File.expect);

	let cMetadata = await std.file.executableMetadata(cOut);
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

	let testCXXSource = tg.file(`
		#include <iostream>
		int main() {
			std::cout << "Hello, world!" << std::endl;
			return 0;
		}
	`);
	let cxxOut = await $`
		set -x && clang++ -v -xc++ ${testCXXSource} -fuse-ld=lld -unwindlib=libunwind -o $OUTPUT
	`
		.env(directory)
		.host(system)
		.then(tg.File.expect);

	let cxxMetadata = await std.file.executableMetadata(cxxOut);
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
