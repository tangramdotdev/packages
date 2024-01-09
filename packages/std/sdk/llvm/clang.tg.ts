import * as std from "../../tangram.tg.ts";
import { type LLVMArg, buildLLVMComponent } from "./mod.tg.ts";

type ClangArg = LLVMArg & {
	compilerRT: tg.Directory;
	libc: tg.Directory;
	lld: tg.Directory;
	llvm: tg.Directory;
	parallelLink?: boolean;
};

export let clang = async (arg: ClangArg) => {
	let { build, env, host } = tg.unimplemented();
	let hostString = std.Triple.toString(host);

	let configureArgs = [
		`-DLLVM_ENABLE_PROJECTS="clang"`,
		"-DLLVM_BUILD_STATIC=ON",
		`-DLLVM_ENABLE_RUNTIMES="compiler-rt;libcxx;libcxxabi;libunwind"`,
		"-DCMAKE_EXE_LINKER_FLAGS=-static",
		tg`-DDEFAULT_SYSROOT=${arg.libc}`,
		// tg`-DGCC_INSTALL_PREFIX=${buildToolchain}`,
		`-DLLVM_RUNTIME_TARGETS=${hostString}`,
		`-DLLVM_HOST_TRIPLE=${hostString}`,
		`-DLLVM_DEFAULT_TARGET_TRIPLE=${hostString}`,
		"-DLIBCLANG_BUILD_STATIC=ON",
		// "-DLLVM_ENABLE_LIBXML2=OFF",
		"-DLLVM_ENABLE_LTO=OFF",
		// "-DLLVM_ENABLE_PIC=OFF",
		"-DLLVM_ENABLE_RTTI=ON",
		"-DLLVM_ENABLE_EH=ON",
		// FIXME - remove targets_to_build once it works.
		`-DLLVM_TARGETS_TO_BUILD="X86;AArch64"`,
		"-DCMAKE_CROSSCOMPILING=True",
		"-DLLVM_INSTALL_UTILS=ON",
	];

	let parallelLink = arg.parallelLink ?? true;
	if (!parallelLink) {
		configureArgs.push("-DLLVM_PARALLEL_LINK_JOBS=1");
	}

	// We don't have a fancy prepend yet, this is just easier than handrolling a general solution.
	let preScript = tg`
		export LIBRARY_PATH="${arg.llvm}/lib64:$LIBRARY_PATH"
	`;
	let buildCommand = "ninja runtimes";
	let installCommand = "ninja install-runtimes";

	return buildLLVMComponent({
		...arg,
		// buildCommand,
		// configureArgs,
		componentName: "llvm",
		env: [env, arg.llvm, arg.libc, arg.lld, arg.compilerRT],
		// installCommand,
		// preScript,
	});
};

export default clang;
