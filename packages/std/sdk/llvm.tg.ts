import * as bootstrap from "../bootstrap.tg.ts";
import { canonicalTriple } from "../sdk.tg.ts";
import * as std from "../tangram.tg.ts";
import * as cmake from "./cmake.tg.ts";
import * as dependencies from "./dependencies.tg.ts";
import * as gcc from "./gcc.tg.ts";
import git from "./git.tg.ts";
import kernelHeaders from "./kernel_headers.tg.ts";
import * as libc from "./libc.tg.ts";
import { interpreterName } from "./libc.tg.ts";

export let metadata = {
	name: "llvm",
	version: "18.1.2",
};

export let source = async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:51073febd91d1f2c3b411d022695744bda322647e76e0b4eb1918229210c48d5";
	let owner = name;
	let repo = "llvm-project";
	let tag = `llvmorg-${version}`;
	let unpackFormat = ".tar.xz" as const;
	let url = `https://github.com/${owner}/${repo}/releases/download/${tag}/${repo}-${version}.src${unpackFormat}`;
	let outer = tg.Directory.expect(
		await std.download({ checksum, url, unpackFormat }),
	);
	return std.directory.unwrap(outer);
};

export type LLVMArg = std.sdk.BuildEnvArg & {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	source?: tg.Directory;
};

export let toolchain = async (arg?: LLVMArg) => {
	let {
		autotools = [],
		build: build_,
		env: env_,
		host: host_,
		source: source_,
		...rest
	} = arg ?? {};
	let host = canonicalTriple(host_ ?? (await std.triple.host()));
	let build = canonicalTriple(build_ ?? host);

	if (std.triple.os(host) !== "linux") {
		throw new Error("LLVM toolchain must be built for Linux");
	}

	let sourceDir = source_ ?? source();

	let linuxHeaders = await tg.directory({
		include: await kernelHeaders({ host }),
	});
	let sysroot = await libc.constructSysroot({
		host,
		linuxHeaders,
	});
	// The buildSysroot helper nests the sysroot under a triple-named directory. Extract the inner dir.
	sysroot = tg.Directory.expect(await sysroot.get(host));
	console.log("llvm sysroot", await sysroot.id());

	let deps: tg.Unresolved<std.env.Arg> = [
		git({ host }),
		dependencies.env({ host: build }),
	];

	let env = [...deps, env_];

	let configureLlvm = {
		args: [
			"-S",
			tg`${sourceDir}/llvm`,
			"-DBOOTSTRAP_CLANG_DEFAULT_CXX_STDLIB=libc++",
			"-DBOOTSTRAP_CLANG_DEFAULT_RTLIB=compiler-rt",
			"-DBOOTSTRAP_CMAKE_BUILD_TYPE=Release",
			"-DBOOTSTRAP_LIBCXX_USE_COMPILER_RT=YES",
			"-DBOOTSTRAP_LIBCXXABI_USE_COMPILER_RT=YES",
			"-DBOOTSTRAP_LIBCXXABI_USE_LLVM_UNWINDER=YES",
			"-DBOOTSTRAP_LIBUNWIND_USE_COMPILER_RT=YES",
			"-DBOOTSTRAP_LLVM_USE_LINKER=lld",
			"-DCLANG_DEFAULT_CXX_STDLIB=libc++",
			"-DCLANG_DEFAULT_RTLIB=compiler-rt",
			"-DCLANG_ENABLE_BOOTSTRAP=ON",
			"-DCMAKE_BUILD_TYPE=Release",
			"-DCMAKE_INSTALL_LIBDIR=lib",
			"-DCMAKE_SKIP_INSTALL_RPATH=ON",
			"-DCOMPILER_RT_BUILD_PROFILE=ON",
			tg`-DDEFAULT_SYSROOT=${sysroot}`,
			"-DLIBCXX_ENABLE_STATIC_ABI_LIBRARY=ON",
			"-DLIBCXX_USE_COMPILER_RT=YES",
			"-DLIBCXXABI_USE_COMPILER_RT=YES",
			"-DLIBCXXABI_USE_LLVM_UNWINDER=YES",
			"-DLIBUNWIND_USE_COMPILER_RT=YES",
			"-DLLVM_ENABLE_EH=ON",
			"-DLLVM_ENABLE_LIBXML2=OFF",
			"-DLLVM_ENABLE_PIC=ON",
			"-DLLVM_ENABLE_PROJECTS='clang;clang-tools-extra;lld;lldb'",
			"-DLLVM_ENABLE_RTTI=ON",
			"-DLLVM_ENABLE_RUNTIMES='compiler-rt;libcxx;libcxxabi;libunwind'",
			"-DLLVM_INSTALL_BINUTILS_SYMLINKS=ON",
			"-DLLVM_PARALLEL_LINK_JOBS=1",
		],
	};

	let llvmArtifact = await cmake.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			env,
			phases: {
				configure: configureLlvm,
			},
			source: sourceDir,
		},
		autotools,
	);
	console.log("llvmArtifact with compiler RT", await llvmArtifact.id());

	// Add sysroot and `cc`/`c++` symlinks.
	llvmArtifact = await tg.directory(llvmArtifact, sysroot, {
		"bin/cc": tg.symlink("clang"),
		"bin/c++": tg.symlink("clang++"),
	});
	console.log("llvmArtifact with sysroot", await llvmArtifact.id());

	return llvmArtifact;
};

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
	let clangxxArgs = [...clangArgs];
	let env = {};
	if (std.triple.os(host) === "darwin") {
		// Note - the Apple Clang version provided by the OS is 15, not ${version}.
		clangArgs.push(tg`-resource-dir=${toolchainDir}/lib/clang/15.0.0`);
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
	let host = await std.triple.host();
	let hostArch = std.triple.arch(host);
	let os = std.triple.os(std.triple.archAndOs(host));

	let libDir = std.triple.environment(host) === "musl" ? "lib" : "lib64";
	let expectedInterpreter =
		os === "darwin" ? undefined : `/${libDir}/${interpreterName(host)}`;

	let fullLlvmPlusClang = await toolchain({ host });

	let testCSource = tg.file(`
		#include <stdio.h>
		int main() {
			printf("Hello, world!\\n");
			return 0;
		}
	`);
	let cScript = tg`
		set -x && clang -xc ${testCSource} -fuse-ld=lld -o $OUTPUT
	`;
	let cOut = tg.File.expect(
		await std.build(cScript, {
			env: fullLlvmPlusClang,
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
		set -x && clang++ -xc++ ${testCXXSource} -fuse-ld=lld -unwindlib=libunwind -isystem${fullLlvmPlusClang}/include/c++/v1 -isystem${fullLlvmPlusClang}/include/${host}/c++/v1 -o $OUTPUT
	`;
	let cxxOut = tg.File.expect(
		await std.build(cxxScript, {
			env: [
				fullLlvmPlusClang,
				{
					LD_LIBRARY_PATH: tg.Mutation.templatePrepend(
						tg`${fullLlvmPlusClang}/lib/${host}`,
						":",
					),
				},
			],
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

	return fullLlvmPlusClang;
};
