import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.tg.ts";
import * as cmake from "./cmake.tg.ts";
import * as dependencies from "./dependencies.tg.ts";
import * as gcc from "./gcc.tg.ts";
import { buildSysroot } from "./gcc/toolchain.tg.ts";
import git from "./git.tg.ts";
import { interpreterName } from "./libc.tg.ts";

export let metadata = {
	name: "llvm",
	version: "17.0.6",
};

export let source = async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:58a8818c60e6627064f312dbf46c02d9949956558340938b71cf731ad8bc0813";
	let owner = name;
	let repo = "llvm-project";
	let tag = `llvmorg-${version}`;
	let unpackFormat = ".tar.xz" as const;
	let url = `https://github.com/${owner}/${repo}/releases/download/${tag}/${repo}-${version}.src${unpackFormat}`;
	let outer = tg.Directory.expect(
		await std.download({ checksum, url, unpackFormat }),
	);
	return std.directory.unwrap(outer);
	// return std.download.fromGithub({ checksum, owner, repo, tag, version });
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
	let host = host_ ? tg.triple(host_) : await tg.Triple.host();
	let hostString = tg.Triple.toString(host);
	let build = build_ ? tg.triple(build_) : host;

	if (host.os !== "linux") {
		throw new Error("LLVM toolchain must be built for Linux");
	}

	let sourceDir = source_ ?? source();

	let sysroot = await buildSysroot({
		host,
	});
	// The buildSysroot helper nests the sysroot under a triple-named directory. Extract the inner dir.
	sysroot = tg.Directory.expect(await sysroot.get(tg.Triple.toString(host)));
	console.log("llvm sysroot", sysroot);

	let gccToolchain = gcc.toolchain(tg.Triple.rotate({ build, host }));

	let deps: tg.Unresolved<std.env.Arg> = [
		git({ host }),
		gccToolchain,
		dependencies.env({ host: build }),
	];

	let env = [
		...deps,
		{
			CC: tg`gcc --sysroot=${sysroot}`,
			CXX: tg`g++ --sysroot=${sysroot}`,
			LDFLAGS: tg.Mutation.templatePrepend(
				tg`-Wl,-dynamic-linker,${sysroot}/lib/${interpreterName(
					host,
				)} -Wl,-rpath,${sysroot}/lib:${gccToolchain}/lib`,
				" ",
			),
		},
		env_,
	];

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
			"-DCOMPILER_RT_BUILD_PROFILE=ON",
			tg`-DDEFAULT_SYSROOT=${sysroot}`,
			tg`-DGCC_INSTALL_PREFIX=${gccToolchain}`,
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
			...tg.Triple.rotate({ build, host }),
			bootstrapMode: true,
			env,
			phases: {
				configure: configureLlvm,
			},
			source: sourceDir,
		},
		autotools,
	);
	console.log("llvmArtifact with compiler RT", await llvmArtifact.id());

	llvmArtifact = await tg.directory(llvmArtifact, sysroot);
	console.log("llvmArtifact with sysroot", await llvmArtifact.id());

	return llvmArtifact;
};

export let test = async () => {
	// Build a triple for the detected host.
	let host = await tg.Triple.host();

	let os = tg.Triple.os(tg.Triple.archAndOs(host));

	let libDir = host.environment === "musl" ? "lib" : "lib64";
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
		tg.assert(cMetadata.arch === host.arch);
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
		set -x && clang++ -xc++ ${testCXXSource} -fuse-ld=lld -unwindlib=libunwind -o $OUTPUT
	`;
	let hostString = tg.Triple.toString(host);
	let cxxOut = tg.File.expect(
		await std.build(cxxScript, {
			env: [
				fullLlvmPlusClang,
				{
					LD_LIBRARY_PATH: tg.Mutation.templatePrepend(
						tg`${fullLlvmPlusClang}/lib/${hostString}`,
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
		tg.assert(cxxMetadata.arch === host.arch);
	} else if (os === "darwin") {
		tg.assert(cxxMetadata.format === "mach-o");
	}

	return fullLlvmPlusClang;
};
