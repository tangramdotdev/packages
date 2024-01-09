import * as std from "../../tangram.tg.ts";
import { type Arg } from "../mod.tg.ts";
import { buildLLVMComponent, llvmMetaSource } from "./mod.tg.ts";

type LibCXXABIArg = {
	compilerRT: tg.Directory;
	cxxHeaders: tg.Directory;
	libc: tg.Directory;
	llvm: tg.Directory;
	libUnwind: tg.Directory;
	parallelLink?: boolean;
} & Arg;

export let libcxxabi = async (arg: LibCXXABIArg) => {
	let configureArgs = [
		`-DLLVM_ENABLE_RUNTIMES="libcxxabi"`,
		"-DLLVM_ENABLE_LTO=OFF",
		"-DLLVM_ENABLE_PIC=OFF",
		"-DLLVM_ENABLE_LIBCXX=ON",
		"-DLIBCXXABI_USE_LLVM_UNWINDER=ON",
		// "-DLIBCXX_USE_COMPILER_RT=ON",
		// "-DLIBCXX_ADDITIONAL_LIBRARIES=unwind",
		"-DCMAKE_EXE_LINKER_FLAGS=-nostdlib",
		"-DCMAKE_SHARED_LINKER_FLAGS=-nostdlib",
		t`-DLIBCXXABI_LIBCXX_INCLUDES="${arg.cxxHeaders}/include/c++/v1"`,
		// NOTE - a working c++ stdlib is not required, but cmake checks for one anyway. Disable the check.
		"-DCMAKE_CXX_COMPILER_WORKS=ON",
	];

	let parallelLink = arg.parallelLink ?? true;
	if (!parallelLink) {
		configureArgs.push("-DLLVM_PARALLEL_LINK_JOBS=1");
	}

	// We don't have a fancy prepend yet, this is just easier than handrolling a general solution.
	let preScript = tg`
		set -x
		export LIBRARY_PATH="${arg.llvm}/lib64:$LIBRARY_PATH"
	`;

	let buildCommand = "ninja cxxabi";
	let installCommand = "ninja install-cxxabi";

	// Use a patched llvm meta source to allow a standalone libcxxabi build.
	let source = await llvmMetaSource();
	let patch = tg.File.expect(await tg.include("./libcxxabi_standalone.patch"));
	source = await std.patch(source, patch);

	return buildLLVMComponent({
		...arg,
		buildCommand,
		configureArgs,
		componentName: "runtimes",
		dependencies: [arg.compilerRT, arg.libc, arg.llvm, arg.libUnwind],
		installCommand,
		preScript,
		source,
	});
};

export default libcxxabi;
