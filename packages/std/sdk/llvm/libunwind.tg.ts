import { type Arg } from "../mod.tg.ts";
import { configure } from "../mod.tg.ts";
import { zlib } from "../support/mod.tg.ts";
import { buildLLVMComponent } from "./mod.tg.ts";

type LibUnwindArg = {
	libc: tg.Directory;
	llvm: tg.Directory;
	parallelLink?: boolean;
} & Arg;

export let libUnwind = async (arg: LibUnwindArg) => {
	let { host } = await configure(arg);
	let zlibArtifact = await zlib({ host });

	let configureArgs = [
		"-DLLVM_ENABLE_LIBXML2=OFF",
		"-DLLVM_ENABLE_LTO=OFF",
		"-DLLVM_ENABLE_PIC=OFF",
		"-DLLVM_ENABLE_ZLIB=ON",
		t`-DZLIB_LIBRARY=${zlibArtifact}/lib/libz.a`,
		t`-DZLIB_INCLUDE_DIR=${zlibArtifact}/include`,
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

	let result = await buildLLVMComponent({
		...arg,
		configureArgs,
		componentName: "libunwind",
		dependencies: [arg.libc, arg.llvm],
		preScript,
	});

	// Add symlink required by libcxxabi
	result = await tg.directory(result, {
		"lib/libunwind_shared.so": tg.symlink("libunwind.so"),
	});

	return result;
};

export default libUnwind;
