import * as std from "../../tangram.tg.ts";
import { buildLLVMComponent } from "../llvm.tg.ts";

type LibCXXArg = {
	compilerRT: tg.Directory;
	libc: tg.Directory;
	llvm: tg.Directory;
	libcxxabi?: tg.Directory;
	headersOnly?: boolean;
	parallelLink?: boolean;
} & std.sdk.BuildEnvArg;

export let libcxx = async (arg: LibCXXArg) => {
	let headersOnly = arg.headersOnly ?? false;
	if (!headersOnly && !arg.libcxxabi) {
		throw new Error("libcxxabi is required if headersOnly is false");
	}

	let libcxxabi = headersOnly ? "none" : "system-libcxxabi";

	let configureArgs = [
		// "-DCMAKE_EXE_LINKER_FLAGS=-static",
		"-DLLVM_ENABLE_RUNTIMES=libcxx",
		"-DLLVM_ENABLE_LTO=OFF",
		"-DLLVM_ENABLE_PIC=OFF",
		`-DLIBCXX_CXX_ABI=${libcxxabi}`,
		"-DLIBCXX_HAS_MUSL_LIBC=1",
		"-DLIBCXX_USE_COMPILER_RT=ON",
		// NOTE - it requires libunwind but won't pull it in automatically.
		"-DLIBCXX_ADDITIONAL_LIBRARIES=unwind",
	];

	// If only building headers, artificially bypass checking for a compiler.
	if (headersOnly) {
		configureArgs.push("-DCMAKE_C_COMPILER_WORKS=ON");
		configureArgs.push("-DCMAKE_CXX_COMPILER_WORKS=ON");
	}

	let parallelLink = arg.parallelLink ?? true;
	if (!parallelLink) {
		configureArgs.push("-DLLVM_PARALLEL_LINK_JOBS=1");
	}

	// We don't have a fancy prepend yet, this is just easier than handrolling a general solution.
	let preScript = tg`
		set -x
		export LIBRARY_PATH="${arg.llvm}/lib64:$LIBRARY_PATH"
	`;

	// If only building headers, override the build and install commands;
	let buildCommand;
	let installCommand;
	if (headersOnly) {
		buildCommand = `
			ninja generate-cxx-headers
		`;
		installCommand = `
			ninja install-cxx-headers
		`;
	}

	return buildLLVMComponent({
		...arg,
		// buildCommand,
		// configureArgs,
		componentName: "runtimes",
		// dependencies: [arg.compilerRT, arg.libc, arg.llvm],
		// installCommand,
		// preScript,
	});
};

export default libcxx;
