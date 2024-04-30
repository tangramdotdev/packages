import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.tg.ts";
import * as cmake from "./cmake.tg.ts";
import * as dependencies from "./dependencies.tg.ts";
import git from "./git.tg.ts";
import * as libc from "./libc.tg.ts";
import { buildToHostCrossToolchain } from "./gcc/toolchain.tg.ts";

export let metadata = {
	name: "llvm",
	version: "18.1.4",
};

export let source = async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:2c01b2fbb06819a12a92056a7fd4edcdc385837942b5e5260b9c2c0baff5116b";
	let owner = name;
	let repo = "llvm-project";
	let tag = `llvmorg-${version}`;
	let extension = ".tar.xz";
	let url = `https://github.com/${owner}/${repo}/releases/download/${tag}/${repo}-${version}.src${extension}`;
	let outer = tg.Directory.expect(await std.download({ checksum, url }));
	return std.directory.unwrap(outer);
};

export type LLVMArg = std.sdk.BuildEnvArg & {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	source?: tg.Directory;
};

export let toolchain = tg.target(async (arg?: LLVMArg) => {
	let {
		autotools = [],
		build: build_,
		env: env_,
		host: host_,
		source: source_,
		...rest
	} = arg ?? {};
	let host = std.sdk.canonicalTriple(host_ ?? (await std.triple.host()));
	let build = build_ ?? host;

	if (std.triple.os(host) === "darwin") {
		// On macOS, just return the bootstrap toolchain, which provides Apple Clang.
		return bootstrap.sdk.env(host);
	}

	let sourceDir = source_ ?? source();

	// Use the internal GCC bootstrapping function to avoid needlesssly rebuilding glibc.
	let { sysroot } = await buildToHostCrossToolchain(host);
	// The buildSysroot helper nests the sysroot under a triple-named directory. Extract the inner dir.
	sysroot = tg.Directory.expect(await sysroot.get(host));
	console.log("llvm sysroot", await sysroot.id());

	//let zlibArtifact = await dependencies.zlib.build({ host: build });
	let deps: tg.Unresolved<std.env.Arg> = [
		std.utils.env({ host: build }),
		git({ host: build }),
		dependencies.python.build({
			host: build,
			sdk: bootstrap.sdk.arg(build),
		}),
		//{ TANGRAM_LINKER_PASSTHROUGH: "1" },
		//zlibArtifact,
	];

	let env = [...deps, env_];

	let ldsoName = libc.interpreterName(host);
	let stage2Ldflags = tg`-Wl,-rpath=${sysroot}/lib:/home/tangram/work/lib:/home/tangram/work/lib/${host} -Wl,-dynamic-linker=${sysroot}/lib/${ldsoName} -unwindlib=libunwind`;

	// TODO - use cmake cache files.
	// https://github.com/llvm/llvm-project/blob/main/clang/cmake/caches/DistributionExample.cmake
	/*
 for bootstrap cmake args.
				-DLLVM_TOOLCHAIN_TOOLS='dsymutil;llvm-cov;llvm-darfdump;llvm-profdata;llvm-objdump;llvm-nm;llvm-size';\
				-DLLVM_DISTRIBUTION_COMPONENTS='clang;LTO;clang-format;clang-resource-headers;builtins;runtimes;dsymutil;llvm-cov;llvm-darfdump;llvm-profdata;llvm-objdump;llvm-nm;llvm-size'"`,
*/

	let configure = {
		args: [
			tg`-DBOOTSTRAP_CMAKE_EXE_LINKER_FLAGS='${stage2Ldflags}'`,
			`-DBOOTSTRAP_CMAKE_SHARED_LINKER_FLAGS='-unwindlib=libunwind'`,
			"-DBOOTSTRAP_CMAKE_BUILD_TYPE=Release",
			"-DBOOTSTRAP_CLANG_DEFAULT_CXX_STDLIB=libc++",
			"-DBOOTSTRAP_CLANG_DEFAULT_RTLIB=compiler-rt",
			"-DBOOTSTRAP_LIBCXX_USE_COMPILER_RT=YES",
			"-DBOOTSTRAP_LIBCXXABI_USE_COMPILER_RT=YES",
			"-DBOOTSTRAP_LIBCXXABI_USE_LLVM_UNWINDER=YES",
			"-DBOOTSTRAP_LIBUNWIND_USE_COMPILER_RT=Yes",
			"-DBOOTSTRAP_LLVM_ENABLE_LTO=ON",
			"-DBOOTSTRAP_LLVM_USE_LINKER=lld",
			`-DCLANG_BOOTSTRAP_CMAKE_ARGS="\
				-DLLVM_ENABLE_PROJECTS='clang;clang-tools-extra;lld';\
				-DLLVM_ENABLE_RUNTIMES='compiler-rt;libcxx;libcxxabi;libunwind';\
				-DLLVM_TARGETS_TO_BUILD='X86;ARM;AARCH64';\
				-DCMAKE_BUILD_TYPE=Release;\
				-DCMAKE_C_FLAGS_RELEASE='-O3 -gline-tables-only -DNDEBUG';\
				-DCMAKE_CXX_FLAGS_RELEASE='-O3 -gline-tables-only -DNDEBUG';\
				-DLLVM_INSTALL_TOOLCHAIN_ONLY=ON;"`,
			`-DCLANG_BOOTSTRAP_PASSTHROUGH="DEFAULT_SYSROOT;LLVM_PARALLEL_LINK_JOBS"`,
			`-DCLANG_BOOTSTRAP_TARGET='check-all;check-llvm;check-clang;llvm-config;test-suite;test-depends;llvm-test-depends;clang-test-depends;distribution;install-distribution;clang'`,
			"-DCLANG_DEFAULT_CXX_STDLIB=libc++",
			"-DCLANG_DEFAULT_RTLIB=compiler-rt",
			"-DCLANG_ENABLE_BOOTSTRAP=ON",
			"-DCMAKE_BUILD_TYPE=Release",
			"-DCMAKE_INSTALL_LIBDIR=lib",
			"-DCMAKE_SKIP_INSTALL_RPATH=ON",
			tg`-DDEFAULT_SYSROOT=${sysroot}`,
			"-DLIBCXX_ENABLE_STATIC_ABI_LIBRARY=ON",
			"-DLIBCXX_USE_COMPILER_RT=YES",
			"-DLIBCXXABI_USE_COMPILER_RT=YES",
			"-DLIBCXXABI_USE_LLVM_UNWINDER=YES",
			"-DLIBUNWIND_USE_COMPILER_RT=YES",
			"-DLLVM_ENABLE_EH=ON",
			"-DLLVM_ENABLE_LIBXML2=OFF",
			"-DLLVM_ENABLE_PIC=ON",
			"-DLLVM_ENABLE_PROJECTS='clang;clang-tools-extra;lld'",
			"-DLLVM_ENABLE_RTTI=ON",
			"-DLLVM_ENABLE_RUNTIMES='compiler-rt;libcxx;libcxxabi;libunwind'",
			"-DLLVM_INSTALL_BINUTILS_SYMLINKS=ON",
			"-DLLVM_INSTALL_TOOLCHAIN_ONLY=ON",
			//`-DLLVM_TOOLCHAIN_TOOLS='dsymutil;llvm-cov;llvm-darfdump;llvm-profdata;llvm-objdump;llvm-nm;llvm-size'`,
			//`-DLLVM_DISTRIBUTION_COMPONENTS='clang;LTO;clang-format;clang-resource-headers;builtins;runtimes;dsymutil;llvm-cov;llvm-darfdump;llvm-profdata;llvm-objdump;llvm-nm;llvm-size'`,
			"-DLLVM_PARALLEL_LINK_JOBS=1",
			"-DLLVM_TARGETS_TO_BUILD=Native", // This only applies to stage1, which we throw away.
			"-DPACKAGE_VENDOR=Tangram",
			//tg`-DZLIB_ROOT=${zlibArtifact}`,
		],
	};

	// let buildPhase = tg.Mutation.set("ninja stage2-distribution");
	// let install = tg.Mutation.set("ninja stage2-install-distribution");
	let buildPhase = tg.Mutation.set("ninja stage2");
	let install = tg.Mutation.set("ninja stage2-install");
	let phases = { configure, build: buildPhase, install };

	let llvmArtifact = await cmake.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			env,
			phases,
			source: tg`${sourceDir}/llvm`,
		},
		autotools,
	);

	// Add sysroot and `cc`/`c++` symlinks.
	llvmArtifact = await tg.directory(llvmArtifact, {
		"bin/cc": tg.symlink("clang"),
		"bin/c++": tg.symlink("clang++"),
	});
	let combined = tg.directory(llvmArtifact, sysroot);
	console.log("combined llvm + sysroot", await (await combined).id());

	return combined;
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

	let clangArgs: tg.Unresolved<tg.Template.Arg> = [];
	let clangxxArgs: tg.Unresolved<tg.Template.Arg> = [];
	let env = {};
	if (std.triple.os(host) === "darwin") {
		// Note - the Apple Clang version provided by the OS is 15, not ${version}.
		clangArgs.push(tg`-resource-dir=${toolchainDir}/lib/clang/15.0.0`);
		clangxxArgs = [...clangArgs];
		env = {
			SDKROOT: tg.Mutation.setIfUnset(bootstrap.macOsSdk()),
		};
	} else {
		clangArgs.push(tg`-resource-dir=${toolchainDir}/lib/clang/${version}`);
		clangxxArgs.push(tg`-resource-dir=${toolchainDir}/lib/clang/${version}`);
		clangxxArgs.push(tg`-unwindlib=libunwind`);
		clangxxArgs.push(tg`-L${toolchainDir}/lib/${target}`);
		clangxxArgs.push(tg`-isystem${toolchainDir}/include/c++/v1`);
		clangxxArgs.push(tg`-isystem${toolchainDir}/include/${target}/c++/v1`);
	}

	return { clangArgs, clangxxArgs, env };
};

export let test = async () => {
	// Build a triple for the detected host.
	let host = std.sdk.canonicalTriple(await std.triple.host());
	let hostArch = std.triple.arch(host);
	let os = std.triple.os(std.triple.archAndOs(host));

	let libDir = std.triple.environment(host) === "musl" ? "lib" : "lib64";
	let expectedInterpreter =
		os === "darwin" ? undefined : `/${libDir}/${libc.interpreterName(host)}`;

	let directory = await toolchain({ host });

	let testCSource = tg.file(`
		#include <stdio.h>
		int main() {
			printf("Hello, world!\\n");
			return 0;
		}
	`);
	let cScript = tg`
		set -x && clang -v -xc ${testCSource} -fuse-ld=lld -o $OUTPUT
	`;
	let cOut = tg.File.expect(
		await std.build(cScript, {
			env: directory,
			host,
		}),
	);

	let cMetadata = await std.file.executableMetadata(cOut);
	if (os === "linux") {
		tg.assert(cMetadata.format === "elf");
		tg.assert(cMetadata.interpreter === expectedInterpreter);
		tg.assert(cMetadata.arch === hostArch);
	} else if (os === "darwin") {
		tg.assert(cMetadata.format === "mach-o");
	}

	let testCXXSource = tg.file(`
		#include <iostream>
		int main() {
			std::cout << "Hello, world!" << std::endl;
			return 0;
		}
	`);
	let cxxScript = tg`
		set -x && clang++ -v -xc++ ${testCXXSource} -fuse-ld=lld -unwindlib=libunwind -o $OUTPUT
	`;
	let cxxOut = tg.File.expect(
		await std.build(cxxScript, {
			env: [directory],
			host,
		}),
	);

	let cxxMetadata = await std.file.executableMetadata(cxxOut);
	if (os === "linux") {
		tg.assert(cxxMetadata.format === "elf");
		tg.assert(cxxMetadata.interpreter === expectedInterpreter);
		tg.assert(cxxMetadata.arch === hostArch);
	} else if (os === "darwin") {
		tg.assert(cxxMetadata.format === "mach-o");
	}

	return directory;
};
