import * as std from "../../tangram.tg.ts";
import { libc } from "../libc.tg.ts";
import { type LLVMArg, buildLLVMComponent } from "../llvm.tg.ts";

// TODO -separate llvm-bintools?
// FIXME - don't produce lib/lib64 - just lib. Best to do it at config time, but we have a tool for post-processing if needed.

// 	// NOTE - `libc` fails to configure.
// 	// NOTE - `openmp` requires perl.
// 	// Could use liblzma, swig for full python support.
// 	// SEE https://github.com/ClangBuiltLinux/tc-build/issues/150#issuecomment-1005053204

// 	// NOTE - removed lldb, "The dependency target "LTO" of target "lldb-test-depends" does not exist"

// 	// NOTE - when LLVM_ENABLE_PIC is OFF, we don't get the _static targets?  we need both SHARED and STATIC.

// 	// see https://reviews.llvm.org/D79059

// 	// NOTE LIBCLANG_BUILD_STATIC is necessary!
// 	// TODO try LLVM_ENABLE_LTO once things work.

/** Compile LLVM. This does not include peripheral projects like `clang` or runtimes like `libcxx` */
export let llvm = async (arg?: LLVMArg) => {
	let { host } = await std.sdk.buildEnv(arg);
	let hostString = std.Triple.toString(host);
	let parallelLink = arg?.parallelLink ?? true;

	// let sysroot = libc({ host });

	let configureArgs = [
		// "-DCMAKE_EXE_LINKER_FLAGS=-static",
		// "-DLLVM_BUILD_STATIC=ON",
		// "-DLLVM_ENABLE_LIBXML2=OFF",
		// "-DLLVM_ENABLE_LTO=OFF",
		// "-DLLVM_ENABLE_PIC=OFF",
		// "-DLLVM_BUILD_LLVM_DYLIB=OFF",
		// RPATH_CHANGE doesnt work, but tangram wrappers should take care of this?
		`-DCMAKE_SKIP_INSTALL_RPATH=ON`,
		`-DLLVM_HOST_TRIPLE=${hostString}`,
		// tg`-DDEFAULT_SYSROOT=${sysroot}`,
		`-DLLVM_DEFAULT_TARGET_TRIPLE=${hostString}`,
		// "-DLLVM_LINK_LLVM_DYLIB=OFF",
		`-DLLVM_ENABLE_PROJECTS="clang;clang-tools-extra;lld;lldb"`,
		`-DLLVM_ENABLE_RUNTIMES="libcxx;libcxxabi;libunwind;compiler-rt"`,
		"-DLLVM_INSTALL_UTILS=ON",
		"-DLLVM_ENABLE_EH=ON",
		"-DLLVM_ENABLE_FFI=ON",
		"-DLLVM_ENABLE_RTTI=ON",
		// FIXME - remove targets_to_build once it works.
		// `-DLLVM_TARGETS_TO_BUILD="X86;AArch64"`,
		// Note - the arch and OS are the same, but the triple for the bootstrap toolchain is different than our intended host.
		// "-DCMAKE_CROSSCOMPILING=True",
	];

	if (!parallelLink) {
		configureArgs.push("-DLLVM_PARALLEL_LINK_JOBS=1");
	}

	// let env = {
	// 	CFLAGS: "-static",
	// 	CXXFLAGS: "-static",
	// };

	return buildLLVMComponent({
		...arg,
		componentName: "llvm",
		// configureArgs,
		// env: sysroot,
		// parallel: true,
		// dependencies: [arg.libc, arg.compilerRT],
		// env,
	});
};

export default llvm;

// --------------------

// FIXME - Clean up these notes when you're sure you don't need the code.

// NOTE - with the Debug build, I get OOM issues when linking! RelWithDebugInfo. If still bad, lower jobs. Could also try `gold` instead.
// TODO - Release works as-is, but Debug and RelWithDebInfo require PARALLEL_LINK_JOBS=1 - tie the two?

/*

			// CLANG STUFF
			-DLLVM_ENABLE_PROJECTS="clang;lld"                                             \
			-DLLVM_ENABLE_RUNTIMES="libcxx;libcxxabi;libunwind;compiler-rt"                \
			-DLIBCLANG_BUILD_STATIC=ON                                                     \

		-DLLVM_ENABLE_LTO=ON                                                           \


			Exception handling requires RTTI but this didn't work.
			-DLLVM_ENABLE_EH=ON                                               \
			-DLLVM_ENABLE_RTTI=ON                                             \

			Were these necessary?
			-DCMAKE_INSTALL_BINDIR="$OUTPUT/bin"                         \
			-DCMAKE_INSTALL_LIBDIR="$OUTPUT/lib"                         \
			-DCMAKE_INSTALL_INCLUDEDIR="$OUTPUT/include"                 \
			-DCMAKE_INSTALL_LIBEXECDIR="$OUTPUT/libexec"                 \




			-DBUILD_SHARED_LIBS=OFF                                           \
*/

// export let bootstrapLlvm = tg.target(async (arg: LLvmArg) => {
// 	let triple = arg.triple;
// 	let system = std.Triple.system(triple);

// 	let hostToolchain = arg.hostToolchain;

// 	let sourceArtifact = source();

// 	let ncursesArtifact = ncurses({ system, hostToolchain });
// 	// let libeditArtifact = await libedit({
// 	// 	system,
// 	// 	hostToolchain,
// 	// 	ncurses: ncursesArtifact,
// 	// });
// 	// console.log("libedit", libeditArtifact);
// 	let zlibArtifact = zlib({ system, hostToolchain });

// 	// Force a musl triple.
// 	// FIXME - like gcc, the triple should come in as a parameter.
// 	let defaultTriple = std.Triple.defaultForSystem(system);
// 	defaultTriple.environment = "musl";
// 	let defaultTripleString = std.Triple.toString(defaultTriple);

// 	// NOTE - cmake requires semicolon-separated lists of paths, not colon-separated!

// 	let script = tg`
// 		set -x
// 		env
// 		export CMAKE_INCLUDE_PATH=$(echo "$CPATH" | tr ':' ';')
// 		export CMAKE_LIBRARY_PATH=$(echo "$LIBRARY_PATH" | tr ':' ';')
// 		cmake                                                                            \
// 			-S ${sourceArtifact}/llvm                                                      \
// 			-G Ninja                                                                       \
// 			-DCMAKE_BUILD_TYPE=RelWithDebInfo                                              \
// 			-DCMAKE_INCLUDE_PATH=$CMAKE_INCLUDE_PATH                                       \
// 			-DCMAKE_INSTALL_PREFIX="$OUTPUT"                                          \
// 			-DCMAKE_LIBRARY_PATH=$CMAKE_LIBRARY_PATH                                       \
// 			-DLLVM_BUILD_STATIC=ON                                                         \
// 			-DLLVM_DEFAULT_TARGET_TRIPLE="${defaultTripleString}"                          \
// 			-DLLVM_ENABLE_LIBXML2=OFF                                                      \
// 			-DLLVM_ENABLE_LTO=OFF                                                          \
// 			-DLLVM_ENABLE_PIC=ON                                                           \
// 			-DLLVM_INSTALL_UTILS=ON                                                        \
// 			-DLLVM_PARALLEL_LINK_JOBS=1                                                    \
// 			-DLLVM_TARGETS_TO_BUILD="AArch64;X86"
// 		cmake --build .
// 		cmake --build . --target install
// 	`;

// 	let result = runWithUtils({
// 		dependencies: [
// 			hostToolchain,
// 			cmake({ hostToolchain, system }),
// 			git({ system, hostToolchain, zlib: zlibArtifact }),
// 			python({ system }),
// 			ncursesArtifact,
// 			ninja({ hostToolchain, system }),
// 			zlibArtifact,
// 		],
// 		script,
// 		system,
// 	});

// 	return result;
// });
