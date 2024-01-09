// import { type Arg } from "../mod.tg.ts";
// import { configure } from "../mod.tg.ts";
// import { zlib } from "../support/mod.tg.ts";
// import { buildLLVMComponent } from "./mod.tg.ts";

// type LLDArg = {
// 	compilerRT: tg.Directory;
// 	libc: tg.Directory;
// 	llvm: tg.Directory;
// 	parallelLink?: boolean;
// } & Arg;

// export let lld = async (arg: LLDArg) => {
// 	let { host } = await configure(arg);
// 	let zlibArtifact = await zlib({ host });

// 	let configureArgs = [
// 		"-DCMAKE_EXE_LINKER_FLAGS=-static",
// 		"-DLLVM_ENABLE_LIBXML2=OFF",
// 		"-DLLVM_ENABLE_LTO=OFF",
// 		"-DLLVM_ENABLE_PIC=OFF",
// 		"-DLLVM_ENABLE_ZLIB=ON",
// 		// FIXME - why do I need to do this manually? It's in CMAKE_LIBRARY_PATH and CMAKE_INCLUDE_PATH.
// 		t`-DZLIB_LIBRARY=${zlibArtifact}/lib/libz.a`,
// 		t`-DZLIB_INCLUDE_DIR=${zlibArtifact}/include`,
// 	];

// 	let parallelLink = arg.parallelLink ?? true;
// 	if (!parallelLink) {
// 		configureArgs.push("-DLLVM_PARALLEL_LINK_JOBS=1");
// 	}

// 	// We don't have a fancy prepend yet, this is just easier than handrolling a general solution.
// 	let preScript = tg`
// 		set -x
// 		export LIBRARY_PATH="${arg.llvm}/lib64:$LIBRARY_PATH"
// 	`;

// 	return buildLLVMComponent({
// 		...arg,
// 		configureArgs,
// 		componentName: "lld",
// 		dependencies: [arg.compilerRT, arg.libc, arg.llvm],
// 		preScript,
// 	});
// };

// export default lld;
