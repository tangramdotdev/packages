// import * as bootstrap from "../bootstrap.tg.ts";
// import { sdk } from "../sdk.tg.ts";
// import * as std from "../tangram.tg.ts";
// import { bootstrapSdk } from "./canadian_cross/stage0.tg.ts";
// import { buildCmakeComponent } from "./cmake.tg.ts";
// import cmake from "./cmake.tg.ts";
// import { kernelHeaders } from "./kernel_headers.tg.ts";
// import { constructSysroot, interpreterName } from "./libc.tg.ts";
// import compilerRT from "./llvm/compiler_rt.tg.ts";
// import llvm from "./llvm/llvm.tg.ts";
// import ninja from "./ninja.tg.ts";
// import { buildWithUtils, libffi } from "./utils.tg.ts";
// import zlib from "./utils/zlib.tg.ts";

// let version = "17.0.3";

// let metadata = {
// 	checksum:
// 		"sha256:dcba3eb486973dce45b6edfe618f3f29b703ae7e6ef9df65182fb50fb6fe4235",
// 	name: "llvm",
// 	owner: "llvm",
// 	repo: "llvm-project",
// 	tag: `llvmorg-${version}`,
// 	url: "github",
// 	version,
// };

// export type LLVMArg = {
// 	build?: any;
// 	env?: any;
// 	hostArg?: std.Triple.Arg;
// 	/** If experiencing OOM issues, set false to not link in parallel. */
// 	parallelLink?: boolean;
// };

// export let toolchain = async (arg?: LLVMArg) => {
// 	// NOTE- "target" is ignored. All LLVM toolchains are multi-target. The SDK constructor will use this field to create convenience wrappers, but we do not use this value to produce the toolchain itself.
// 	let { build, env } = tg.unimplemented();
// 	let host = std.triple(arg?.hostArg ?? (await std.Triple.host()));

// 	let directory = await bootstrap.toolchain({ host });

// 	let cmakeArtifact = await cmake({ env, host });
// 	console.log("cmake", cmakeArtifact);
// 	let ninjaArtifact = await ninja({ env: [env, cmakeArtifact], host });
// 	console.log("ninja", ninjaArtifact);

// 	if (host.os !== "linux") {
// 		throw new Error("LLVM toolchain must be built for Linux");
// 	}

// 	let llvmSource = std.download.fromMetadata(metadata);

// 	// Produce the linux headers.
// 	let linuxHeaders = await kernelHeaders({
// 		env,
// 		target: host,
// 	});
// 	console.log("linuxHeaders", linuxHeaders);

// 	// Produce a combined directory contianing the correct C library for the host and the Linux headers.
// 	let sysroot = await constructSysroot({
// 		linuxHeaders,
// 		env,
// 		target: host,
// 	});
// 	console.log("hostSysroot", sysroot);

// 	let script = tg`
// 		export CMAKE_INCLUDE_PATH=$(echo "$CPATH" | tr ':' ';')
// 		export CMAKE_LIBRARY_PATH=$(echo "$LIBRARY_PATH" | tr ':' ';')
// 		cmake \
// 			-G Ninja \
// 			-DLLVM_ENABLE_PROJECTS="clang;lld" \
// 			-DCMAKE_BUILD_TYPE=Release \
// 			-DDEFAULT_SYSROOT=${sysroot} \
// 			-DCLANG_ENABLE_BOOTSTRAP=On \
// 			-DGCC_INSTALL_PREFIX=${directory} \
// 			-DCLANG_BOOTSTRAP_PASSTHROUGH="CMAKE_INSTALL_PREFIX;CMAKE_INCLUDE_PATH;CMAKE_LIBRARY_PATH;DEFAULT_SYSROOT;GCC_INSTALL_PREFIX" \
// 			-DLLVM_PARALLEL_LINK_JOBS=1 \
// 			-DCMAKE_INSTALL_PREFIX=$OUTPUT \
// 		${llvmSource}/llvm
// 		ninja stage2
// 		ninja stage2-install
// 	`;

// 	let llvmArtifact = tg.Directory.expect(
// 		await build_({
// 			script,
// 			env: [env, ninjaArtifact, cmakeArtifact],
// 			host: build,
// 		}),
// 	);

// 	// Produce the compiler builtins.
// 	// let compilerRTArtifact = await compilerRT(arg);
// 	// console.log("compiler-rt", compilerRTArtifact);

// 	// let llvmArtifact = await llvm(arg);
// 	// console.log("llvm", llvmArtifact);

// 	// // First, nest compilerRT inside clang.
// 	// let clangInternal = tg.Directory.expect(
// 	// 	await llvmArtifact.get("lib/clang/16"),
// 	// );
// 	// clangInternal = await tg.directory(clangInternal, compilerRTArtifact);
// 	// llvmArtifact = await tg.directory(llvmArtifact, {
// 	// 	"lib/clang/16": clangInternal,
// 	// });

// 	return llvmArtifact;
// };

// /** Obtain the complete source for the entire LLVM suite. */
// export let llvmMetaSource = () => {
// 	return std.download.fromMetadata(metadata);
// };

// export type LLVMBuildArg = Omit<std.sdk.BuildEnvArg, "source"> & {
// 	componentName?: string;
// 	/* Note- the source is optional here so we can fall back to the LLVM meta source bundle. */
// 	source?: tg.Directory;
// };

// /* Special case of buildCmakeComponent that handles configuration common to all LLVM components. */
// // TARGET_CANDIDATE
// export let buildLLVMComponent = async (arg: LLVMBuildArg) => {
// 	return tg.unimplemented();
// 	// let componentName = resolved.componentName ?? ".";
// 	// let source = resolved.source ?? llvmMetaSource();
// 	// let configureCommand =
// 	// 	resolved.configureCommand ?? tg`cmake -S ${source}/${componentName}`;
// 	// let configureArgs = [
// 	// 	"-G",
// 	// 	"Ninja",
// 	// 	"-DCMAKE_BUILD_TYPE=Release",
// 	// 	"-DCMAKE_INSTALL_LIBDIR=lib",
// 	// 	...(resolved.configureArgs ?? []),
// 	// ];

// 	// let opt = resolved.opt ?? "3";

// 	// // Translate CPATH and LIBRARY_PATH to CMAKE_INCLUDE_PATH and CMAKE_LIBRARY_PATH.
// 	// // FIXME - do this with typescript/env?
// 	// let preScript = tg`
// 	// 	${resolved.preScript ?? ""}
// 	// 	export CMAKE_INCLUDE_PATH=$(echo "$CPATH" | tr ':' ';')
// 	// 	export CMAKE_LIBRARY_PATH=$(echo "$LIBRARY_PATH" | tr ':' ';')
// 	// `;

// 	// let result = buildCmakeComponent({
// 	// 	...arg,
// 	// 	configureArgs,
// 	// 	configureCommand,
// 	// 	opt,
// 	// 	preScript,
// 	// 	source,
// 	// });
// 	// return result;
// };

// // export let defaultBuildSDK = async (host: std.Triple.Arg) => {
// // 	let base = await bootstrapSdk({ host });
// // 	let cmakeArtifact = await cmake({ host });
// // 	// let libFFI = await libffi({ host });
// // 	// let ninjaArtifact = await ninja({ host });
// // 	return std.env(base, cmakeArtifact);
// // };

// export let proxyEnv = tg.target(async () => {
// 	return tg.unimplemented();
// });

// export let test = async () => {
// 	// Build a triple for the detected host.
// 	let host = await std.Triple.host();

// 	let os = tg.System.os(std.Triple.system(host));

// 	let libDir = host.environment === "musl" ? "lib" : "lib64";
// 	let expectedInterpreter =
// 		os === "darwin" ? undefined : `/${libDir}/${interpreterName(host)}`;

// 	let fullLlvmPlusClang = await toolchain({ hostArg: host });

// 	let testCSource = tg.file(`
// 		#include <stdio.h>
// 		int main() {
// 			printf("Hello, world!\\n");
// 			return 0;
// 		}
// 	`);
// 	let cScript = tg`
// 		clang -xc ${testCSource} -rtlib=compiler-rt -fuse-ld=lld -o $OUTPUT
// 	`;
// 	let cOut = tg.File.expect(
// 		await buildWithUtils({
// 			env: [
// 				fullLlvmPlusClang,
// 				{
// 					LD: tg`$OUTPUT/bin/ld.lld`,
// 				},
// 			],
// 			script: cScript,
// 			host,
// 		}),
// 	);

// 	let cMetadata = await std.file.executableMetadata(cOut);
// 	if (os === "linux") {
// 		tg.assert(cMetadata.format === "elf");
// 		tg.assert(cMetadata.interpreter === expectedInterpreter);
// 		tg.assert(cMetadata.arch === host.arch);
// 	} else if (os === "darwin") {
// 		tg.assert(cMetadata.format === "mach-o");
// 	}

// 	let testCXXSource = tg.file(`
// 		#include <iostream>
// 		int main() {
// 			std::cout << "Hello, world!" << std::endl;
// 			return 0;
// 		}
// 	`);
// 	let cxxScript = tg`
// 		clang++ -xc++ ${testCXXSource} -I${fullLlvmPlusClang}/include/c++/v1 -rtlib=compiler-rt -fuse-ld=lld -o $OUTPUT
// 	`;
// 	let cxxOut = tg.File.expect(
// 		await buildWithUtils({
// 			env: [
// 				fullLlvmPlusClang,
// 				{
// 					LD: tg`$OUTPUT/bin/ld.lld`,
// 				},
// 			],
// 			script: cxxScript,
// 			host,
// 		}),
// 	);

// 	let cxxMetadata = await std.file.executableMetadata(cxxOut);
// 	if (os === "linux") {
// 		tg.assert(cxxMetadata.format === "elf");
// 		tg.assert(cxxMetadata.interpreter === expectedInterpreter);
// 		tg.assert(cxxMetadata.arch === host.arch);
// 	} else if (os === "darwin") {
// 		tg.assert(cxxMetadata.format === "mach-o");
// 	}
// };
