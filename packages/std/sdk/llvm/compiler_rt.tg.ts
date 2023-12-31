import * as std from "../../tangram.tg.ts";
import { type LLVMArg, buildLLVMComponent } from "../llvm.tg.ts";

export let compilerRT = async (arg?: LLVMArg) => {
	let { host } = await std.sdk.buildEnv(arg);
	let hostString = std.Triple.toString(host);
	let parallelLink = arg?.parallelLink ?? true;

	let configureArgs = [
		"-DLLVM_ENABLE_RUNTIMES=compiler-rt",
		"-DCOMPILER_RT_BUILD_LIBFUZZER=NO",
		"-DCOMPILER_RT_BUILD_PROFILE=NO",
		"-DCOMPILER_RT_BUILD_SANITIZERS=NO",
		"-DCOMPILER_RT_BUILD_XRAY=NO",
		`-DCOMPILER_RT_DEFAULT_TARGET_TRIPLE=${hostString}`,
	];

	if (!parallelLink) {
		configureArgs.push("-DLLVM_PARALLEL_LINK_JOBS=1");
	}

	let result = buildLLVMComponent({
		...arg,
		componentName: "runtimes",
		// configureArgs,
	});

	return result;
};

export default compilerRT;
