import * as bootstrap from "../bootstrap.tg.ts";
import * as macho from "../file/macho.tg.ts";
import * as std from "../tangram.ts";
import { $ } from "../tangram.ts";
import * as gnu from "./gnu.tg.ts";
import * as cmake from "./cmake.tg.ts";
import * as dependencies from "./dependencies.tg.ts";
import * as utils from "../utils.tg.ts";
import * as workspace from "../wrap/workspace.tg.ts";
import git from "./llvm/git.tg.ts";
import * as libc from "./libc.tg.ts";
import { constructSysroot } from "./libc.tg.ts";
import cmakeCacheDir from "./llvm/cmake" with { type: "directory" };

export * as git from "./llvm/git.tg.ts";

export const metadata = {
	homepage: "https://llvm.org/",
	name: "llvm",
	license:
		"https://github.com/llvm/llvm-project/blob/llvmorg-23.1.6/LICENSE.TXT",
	repository: "https://github.com/llvm/llvm-project/",
	version: "23.1.6",
	tag: "llvm/23.1.6",
};

export async function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:d3b86ab29cfb4445a6652e5c2642ccc75e04e38084dde3701d323320f35a31da";
	const owner = name;
	const repo = "llvm-project";
	const tag = `llvmorg-${version}`;
	const extension = ".tar.xz";
	const url = `https://github.com/${owner}/${repo}/releases/download/${tag}/${repo}-${version}.src${extension}`;
	return std.download
		.extractArchive({ checksum, url })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
}

export type LLVMArg = {
	build?: string;
	env?: std.env.Arg;
	host?: string;
	lto?: boolean;
	prebuilt?: boolean;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
	target?: string;
};

/** Produce a complete clang+lld distribution. */
export async function toolchain(...args: tg.Args<LLVMArg>) {
	const {
		build: build_,
		env: env_,
		host: host_,
		lto = true,
		sdk,
		source: source_,
		target: target_,
	} = await tg.Args.apply<
		LLVMArg,
		tg.ValueOrMaybeMutationMap<LLVMArg>,
		LLVMArg
	>({
		args,
		map: async (a) => a,
		reduce: {},
	});
	const host = std.sdk.canonicalTriple(host_ ?? std.triple.host());

	const build = build_ ?? host;
	const target = target_ ?? host;

	if (std.triple.os(host) === "darwin") {
		const targetOs = std.triple.os(target);
		if (targetOs === "darwin") {
			const toolchain = await bootstrap.sdk.toolchain(host);
			if (host === target) {
				return toolchain;
			}
			const tools = [
				"ar",
				"cc",
				"c++",
				"clang",
				"clang++",
				"ld",
				"nm",
				"ranlib",
				"strip",
			];
			const aliases = Object.fromEntries(
				tools.map((name) => [`${target}-${name}`, tg.symlink(name)]),
			);
			return tg.directory(toolchain, { bin: aliases });
		} else if (targetOs === "linux") {
			const toolchain = bootstrap.toolchain(host);
			const lld = buildLld({ host });
			const sysroot = getLinuxSysroot(target);
			const tools = [
				"ar",
				"cc",
				"c++",
				"clang",
				"clang++",
				"ld",
				"ld.lld",
				"nm",
				"ranlib",
				"strip",
			];
			const aliases = Object.fromEntries(
				tools.map((name) => [
					`${target}-${name}`,
					tg.symlink(name === "ld" ? "ld.lld" : name),
				]),
			);
			return await tg.directory(toolchain, lld, {
				bin: aliases,
				[`${target}/sysroot`]: sysroot,
			});
		} else {
			return tg.unimplemented(`unrecognized target OS: ${targetOs}`);
		}
	}

	const sourceDir = source_ ?? source();

	// Define build environment.
	const buildTools = std.env.arg(
		std.sdk(),
		tg
			.build(dependencies.buildTools, {
				host,
				preset: "toolchain",
				python: true,
			})
			.named("build tools"),
	);

	// Build host libraries (zlib and ncurses for LLVM).
	const hostLibraries = tg
		.build(dependencies.hostLibraries, {
			host,
			buildToolchain: buildTools,
			preset: "llvm",
		})
		.named("host libraries");

	// Build ncurses and zlib separately for cmake configuration and library paths.
	const zlibArtifact = dependencies.zlib.build({
		host,
		env: buildTools,
		sdk: "none",
	});
	const gitArtifact = git({
		host,
		env: buildTools,
	});

	// Combine into build environment.
	const env = [buildTools, hostLibraries, gitArtifact, env_ ?? null];

	// Obtain a sysroot for the requested host.
	const sysroot = await constructSysroot({
		sdk: "none",
		env: buildTools,
		host,
	})
		.then((dir) => dir.get(host))
		.then(tg.Directory.expect);

	const ldsoName = libc.interpreterName(host);
	// Set the dynamic linker for stage2 binaries. RPATH is configured in Distribution-stage2.cmake
	// using cmake's native RPATH mechanism, which avoids shell escaping issues with $ORIGIN.
	const stage2ExeLinkerFlags = tg`-Wl,-dynamic-linker=${sysroot}/lib/${ldsoName} -unwindlib=libunwind`;

	// Ensure that stage2 unproxied binaries are able to locate libraries during the build, without hardcoding rpaths. We will wrap them afterwards.
	const prepare = tg`set -x && export HOME=$PWD && export LD_LIBRARY_PATH="${sysroot}/lib:${zlibArtifact}/lib:$HOME/build/lib:$HOME/build/lib/${host}"`;

	// Define default flags.
	const configure = {
		args: [
			tg`-DBOOTSTRAP_CMAKE_EXE_LINKER_FLAGS='${stage2ExeLinkerFlags}'`,
			tg`-DDEFAULT_SYSROOT=${sysroot}`,
			`-DLLVM_HOST_TRIPLE=${host}`,
			`-DTANGRAM_HOST_TRIPLE=${host}`,
			"-DLLVM_PARALLEL_LINK_JOBS=1",
			tg`-DZLIB_ROOT=${zlibArtifact}`,
			`-DCLANG_BOOTSTRAP_PASSTHROUGH="DEFAULT_SYSROOT;LLVM_PARALLEL_LINK_JOBS;ZLIB_ROOT;TANGRAM_HOST_TRIPLE"`,
		],
	};

	// Support musl sysroots.
	const isMusl = std.triple.environment(host) === "musl";
	if (isMusl) {
		configure.args.push("-DLIBCXX_HAS_MUSL_LIBC=On");
		configure.args.push("-DBOOTSTRAP_LIBCXX_HAS_MUSL_LIBC=On");
	}

	// Add additional flags from the target args.
	if (lto && !isMusl) {
		configure.args.push("-DBOOTSTRAP_LLVM_ENABLE_LTO=Thin");
	}

	// Add the cmake cache file last.
	configure.args.push(tg`-C${cmakeCacheDir}/Distribution.cmake`);

	const buildPhase = "cd build && ninja stage2-distribution";
	const install = "ninja stage2-install-distribution";
	const phases = { prepare, configure, build: buildPhase, install };

	// Bound the build's hardware threads, which bounds the concurrent C++ compilations of both bootstrap stages, and reserve memory for them, so that the build fits on a machine with many threads and little memory.
	let llvmArtifact = await cmake.build({
		host: build,
		target: host,
		cpu: 4,
		env: std.env.compose(...env),
		memory: { min: 4 * 1024 ** 3 },
		phases,
		...(sdk !== undefined ? { sdk } : {}),
		source: tg`${sourceDir}/llvm`,
	});

	// Merge zlib libraries into the artifact so $ORIGIN-based RPATH can find them.
	const zlibLibDir = await zlibArtifact
		.then(tg.Directory.expect)
		.then((dir) => dir.get("lib"))
		.then(tg.Directory.expect);

	// Add sysroot, zlib libs, and symlinks.
	llvmArtifact = await tg.directory(llvmArtifact, sysroot, {
		lib: zlibLibDir,
		"bin/ar": tg.symlink("llvm-ar"),
		"bin/cc": tg.symlink("clang"),
		"bin/c++": tg.symlink("clang++"),
		"bin/nm": tg.symlink("llvm-nm"),
		"bin/objcopy": tg.symlink("llvm-objcopy"),
		"bin/objdump": tg.symlink("llvm-objdump"),
		"bin/ranlib": tg.symlink("llvm-ar"),
		"bin/readelf": tg.symlink("llvm-readobj"),
		"bin/strings": tg.symlink("llvm-strings"),
		"bin/strip": tg.symlink("llvm-strip"),
	});

	// The bootstrap compiler was not proxied. Manually wrap the output binaries.
	// With $ORIGIN-based RPATH embedded during build, binaries can find libraries
	// relative to their location. We still wrap to ensure the interpreter is correct.

	// Collect library paths for non-clang binaries that may not have RPATH set. The C++ runtimes live in `lib/<triple>`, found by shape rather than by name.
	const libDir = await llvmArtifact.get("lib").then(tg.Directory.expect);
	const libraryPaths: Array<tg.Directory> = [libDir];
	for await (const [name, artifact] of libDir) {
		if (artifact instanceof tg.Directory && std.triple.tryComponents(name)) {
			libraryPaths.push(artifact);
		}
	}

	// Wrap all ELF binaries in the bin directory, except clang-XX which has
	// $ORIGIN RPATH and must not be wrapped to preserve /proc/self/exe for -cc1.
	const majorVersion = llvmMajorVersion();
	const clangBinaryName = `clang-${majorVersion}`;
	const binDir = await llvmArtifact.get("bin").then(tg.Directory.expect);
	for await (const [name, artifact] of binDir) {
		if (artifact instanceof tg.File && name !== clangBinaryName) {
			const { format } = await std.file.executableMetadata(artifact);
			if (format === "elf") {
				const unwrapped = binDir.get(name).then(tg.File.expect);
				const wrapped = std.wrap(unwrapped, {
					libraryPaths,
				});
				llvmArtifact = await tg.directory(llvmArtifact, {
					[`bin/${name}`]: wrapped,
				});
			}
		}
	}

	// The unwrapped clang binary names the sysroot's dynamic linker by its store path. Reference the sysroot so that the dynamic linker is present wherever clang runs.
	await sysroot.store();
	const clangBinary = await binDir.get(clangBinaryName).then(tg.File.expect);
	llvmArtifact = await tg.directory(llvmArtifact, {
		[`bin/${clangBinaryName}`]: tg.file(clangBinary, {
			executable: true,
			dependencies: { [sysroot.id]: sysroot },
		}),
	});

	// Replace clang and clang++ with shell scripts that exec the unwrapped clang binary.
	// This allows the proxy to wrap shell scripts (which have no ELF dependencies) instead
	// of wrapped binaries, enabling the toolchain to work in bootstrap mode.
	// Use /bin/sh directly since PATH may not include /bin in bootstrap mode.
	llvmArtifact = await tg.directory(llvmArtifact, {
		"bin/clang": driverShim(clangBinaryName),
		// `clang-22` reads argv[0] to pick a driver mode, and POSIX sh cannot set it, so ask for C++ mode explicitly. Without it the driver compiles C++ but links no C++ standard library.
		"bin/clang++": driverShim(clangBinaryName, "--driver-mode=g++"),
	});

	if (target !== host) {
		llvmArtifact = await addCrossTarget(llvmArtifact, host, target);
	}

	return llvmArtifact;
}

/** A shell script that execs a sibling driver, falling back to `PATH` when there is no sibling to find.
 *
 * `$0` is the script's own path when it is invoked directly or found on `PATH`, but `std.wrap` re-roots it to a standalone file artifact with no siblings. Preferring the sibling keeps a checked-out toolchain from picking up a foreign compiler; the fallback keeps the wrapped case working. `${var%pattern}` and `[` are shell builtins, so the shim needs nothing on `PATH` to decide.
 */
function driverShim(driver: string, args?: string, preamble?: string) {
	const script = [
		`#!/bin/sh`,
		...(preamble !== undefined ? [preamble] : []),
		`dir=\${0%/*}`,
		`if [ ! -x "\${dir}/${driver}" ]; then`,
		`\tdir=$(command -v ${driver})`,
		`\tdir=\${dir%/*}`,
		`fi`,
		`exec "\${dir}/${driver}"${args !== undefined ? ` ${args}` : ""} "$@"`,
		``,
	].join("\n");
	return tg.file(script, { executable: true });
}

/** Add a target sysroot and the prefixed drivers that select it.
 *
 * This clang is configured with `CLANG_DEFAULT_RTLIB=compiler-rt` and `CLANG_DEFAULT_CXX_STDLIB=libc++`, but those runtimes are only built for the host. The prebuilt target sysroots ship libgcc and libstdc++ instead, so the cross drivers ask for those explicitly.
 */
async function addCrossTarget(
	toolchainDir: tg.Directory,
	host: string,
	target: string,
) {
	const targetOs = std.triple.os(target);
	if (targetOs === "darwin") {
		return await addDarwinCrossTarget(toolchainDir, host, target);
	}
	if (targetOs !== "linux") {
		return tg.unimplemented(`unrecognized cross target OS: ${targetOs}`);
	}

	// The sysroot lands at `${target}`, matching where the GNU toolchain puts its cross sysroot.
	const sysroot = await getLinuxSysroot(target);
	let result = await tg.directory(toolchainDir, { [target]: sysroot });

	const commonFlags = `-target ${target} --sysroot="\${dir}/../${target}" -rtlib=libgcc -unwindlib=libgcc`;
	const drivers: Record<string, string> = {
		clang: commonFlags,
		"clang++": `${commonFlags} --stdlib=libstdc++`,
	};
	for (const [driver, flags] of Object.entries(drivers)) {
		result = await tg.directory(result, {
			[`bin/${target}-${driver}`]: driverShim(driver, flags),
		});
	}

	// The remaining tools are target-agnostic, but the prefixed names are how an SDK advertises which target it serves. The unprefixed `cc` and `c++` go away: a cross SDK gets a linker for its target only, so a native compile through them could not link. The GNU toolchains never define them either.
	return await tg.directory(result, {
		"bin/cc": null,
		"bin/c++": null,
		[`bin/${target}-cc`]: tg.symlink(`${target}-clang`),
		[`bin/${target}-c++`]: tg.symlink(`${target}-clang++`),
		[`bin/${target}-ar`]: tg.symlink("llvm-ar"),
		[`bin/${target}-ld.lld`]: tg.symlink("ld.lld"),
		[`bin/${target}-nm`]: tg.symlink("llvm-nm"),
		[`bin/${target}-objcopy`]: tg.symlink("llvm-objcopy"),
		[`bin/${target}-ranlib`]: tg.symlink("llvm-ar"),
		[`bin/${target}-strip`]: tg.symlink("llvm-strip"),
	});
}

/** Add a macOS SDK and the prefixed drivers and tools that target it.
 *
 * Clang reads the SDK and the linker from a configuration file beside the SDK. The driver does not report an argument from a configuration file as unused, so a compile-only invocation with `-Werror` succeeds. The `-stdlib++-isystem` line keeps the driver from picking up the host libc++ headers installed next to the binary.
 *
 * The `-L` line puts the SDK libraries ahead of the toolchain `lib` directory, which the driver passes to the linker and which holds the host glibc. Without it, `-lc` and `-lm` resolve to the ELF `libc.so` and `libm.so` there instead of the SDK `libc.tbd` and `libm.tbd`.
 */
async function addDarwinCrossTarget(
	toolchainDir: tg.Directory,
	host: string,
	target: string,
) {
	const config = [
		"-fuse-ld=lld",
		"-isysroot <CFGDIR>/MacOSX.sdk",
		"-stdlib++-isystem <CFGDIR>/MacOSX.sdk/usr/include/c++/v1",
		"-L<CFGDIR>/MacOSX.sdk/usr/lib",
		"",
	].join("\n");
	let result = await tg.directory(toolchainDir, {
		[target]: tg.directory(bootstrap.macOsSdk(undefined, host), {
			"clang.cfg": tg.file(config),
		}),
	});

	// The shims default the deployment target so that clang does not derive it from the SDK version.
	const preamble = `export MACOSX_DEPLOYMENT_TARGET="\${MACOSX_DEPLOYMENT_TARGET:-${std.sdk.macOsDeploymentTarget}}"`;
	const flags = `-target ${target} --config="\${dir}/../${target}/clang.cfg"`;
	for (const driver of ["clang", "clang++"]) {
		result = await tg.directory(result, {
			[`bin/${target}-${driver}`]: driverShim(driver, flags, preamble),
		});
	}

	// Clang looks for `ld64.lld` when it links a Darwin target with `-fuse-ld=lld`.
	const hasLd64 = (await toolchainDir.tryGet("bin/ld64.lld")) !== undefined;

	// The unprefixed tools go away so that they cannot shadow the host tools of a native SDK in a combined environment. The `clang` and `clang++` shims stay because the prefixed shims exec them.
	return await tg.directory(result, {
		"bin/ar": null,
		"bin/cc": null,
		"bin/c++": null,
		"bin/nm": null,
		"bin/objcopy": null,
		"bin/objdump": null,
		"bin/ranlib": null,
		"bin/strip": null,
		...(hasLd64 ? {} : { "bin/ld64.lld": tg.symlink("lld") }),
		[`bin/${target}-cc`]: tg.symlink(`${target}-clang`),
		[`bin/${target}-c++`]: tg.symlink(`${target}-clang++`),
		[`bin/${target}-ar`]: tg.symlink("llvm-ar"),
		[`bin/${target}-install_name_tool`]: tg.symlink("llvm-objcopy"),
		[`bin/${target}-ld`]: tg.symlink("ld64.lld"),
		[`bin/${target}-nm`]: tg.symlink("llvm-nm"),
		[`bin/${target}-objcopy`]: tg.symlink("llvm-objcopy"),
		[`bin/${target}-objdump`]: tg.symlink("llvm-objdump"),
		[`bin/${target}-otool`]: tg.symlink("llvm-objdump"),
		[`bin/${target}-ranlib`]: tg.symlink("llvm-ar"),
		[`bin/${target}-strip`]: tg.symlink("llvm-strip"),
	});
}

/** Grab the LLD linker from the toolchain. */
export async function lld(arg?: LLVMArg) {
	const toolchainDir = await toolchain(...(arg !== undefined ? [arg] : []));
	tg.assert(toolchainDir instanceof tg.Directory);
	// Use a template instead of the file directly so the linker proxy invokes the linker by its full name.
	return tg`${toolchainDir}/bin/ld.lld`;
}

/** Build LLD only, without the 2-stage bootstrap. */
export async function buildLld(arg?: LLVMArg) {
	const {
		build: build_,
		env: env_,
		host: host_,
		lto = true, // FIXME - unused.
		sdk,
		source: source_,
	} = arg ?? {};
	const host = host_ ?? std.triple.host();
	const build = build_ ?? host;
	if (std.triple.os(host) === "darwin") {
		// Reuse the pinned Rust linker because the bootstrap CMake package requires Linux.
		const rustHost = std.sdk.canonicalTriple(host);
		const rust = await workspace.rust({ host: rustHost, llvmTools: true });
		const buildToolchain = bootstrap.sdk.env(host);
		const wrapTool = async (name: string, args: Array<string> = []) => {
			const executable = await rust
				.get(`lib/rustlib/${rustHost}/bin/${name}`)
				.then(tg.File.expect);
			return std.wrap(executable, {
				args,
				buildToolchain,
				host,
				libraryPaths: [tg`${rust}/lib`],
			});
		};
		// Apple archive tools do not index ELF objects, so use the LLVM tools for Linux targets.
		const ar = await wrapTool("llvm-ar");
		return tg.directory({
			bin: {
				ar,
				"ld.lld": tg.symlink("lld"),
				lld: wrapTool("rust-lld", ["-flavor", "gnu"]),
				nm: wrapTool("llvm-nm"),
				ranlib: std.wrap(ar, { args: ["s"], buildToolchain, host }),
				strip: wrapTool("llvm-strip"),
			},
		});
	}

	const sourceDir = source_ ?? source();

	const buildToolchain = await std.env.arg(bootstrap.sdk(host));

	// Define build environment.
	const buildTools = await tg.build(dependencies.buildTools, {
		host: build,
		buildToolchain,
		preset: "toolchain",
	});
	const zlibArtifact = await dependencies.zlib.build({
		env: buildToolchain,
		sdk: "none",
	});
	const deps = [buildTools, zlibArtifact];

	const env = await std.env.arg(...deps, buildToolchain, env_ ?? null);

	// Define default flags.
	const configure = {
		args: [
			"-DCMAKE_BUILD_TYPE=Release",
			"-DLLVM_ENABLE_PROJECTS=lld",
			`-DLLVM_HOST_TRIPLE=${host}`,
			"-DLLVM_PARALLEL_LINK_JOBS=1",
			tg`-DZLIB_ROOT=${zlibArtifact}`,
		],
	};

	const phases = { configure };

	let output = await cmake.build({
		host: build,
		target: host,
		sdk: "none",
		env,
		phases,
		...(sdk !== undefined ? { sdk } : {}),
		source: tg`${sourceDir}/llvm`,
	});

	// Wrap lld with zlib.
	return output;
}

/** Cross-compile C and C++ programs for both macOS architectures from Linux. */
export async function testLinuxToDarwin() {
	if (std.triple.os(std.triple.host()) !== "linux") {
		console.log("skipped sdk/llvm.tg.ts#testLinuxToDarwin: requires Linux");
		return null;
	}
	const host = std.sdk.canonicalTriple(std.triple.host());
	const system = std.triple.archAndOs(host);

	const cSource = tg.file`
		#include <stdio.h>
		int main() {
			printf("Hello, world!\\n");
			return 0;
		}
	`;
	const cxxSource = tg.file`
		#include <iostream>
		int main() {
			std::cout << "Hello, world!" << std::endl;
			return 0;
		}
	`;
	// The square root of a runtime value keeps the compiler from folding the call, so the link must resolve `sqrt` through `-lm`.
	const mathSource = tg.file`
		#include <math.h>
		#include <stdio.h>
		int main(int argc, char **argv) {
			printf("%f\\n", sqrt((double)argc));
			return 0;
		}
	`;

	const results: Record<string, tg.Directory> = {};
	for (const arch of ["aarch64", "x86_64"]) {
		const target = `${arch}-apple-darwin`;
		const directory = await toolchain({ host, target }).then(
			tg.Directory.expect,
		);
		const output = await $(std.shBootstrap`
			set -x
			mkdir -p ${tg.output}
			${target}-cc -v -xc ${cSource} -o ${tg.output}/c
			${target}-c++ -v -xc++ ${cxxSource} -o ${tg.output}/cxx
			${target}-cc -v -xc ${mathSource} -o ${tg.output}/math -lc -lm
			${target}-cc -Werror -c -xc ${cSource} -o ${tg.output}/c.o
			${target}-c++ -Werror -c -xc++ ${cxxSource} -o ${tg.output}/cxx.o
		`)
			.env(directory)
			.host(system)
			.then(tg.Directory.expect);

		for (const [name, expectedDependencies] of [
			["c", ["/usr/lib/libSystem.B.dylib"]],
			["cxx", ["/usr/lib/libSystem.B.dylib", "/usr/lib/libc++.1.dylib"]],
			["math", ["/usr/lib/libSystem.B.dylib"]],
		] as const) {
			const executable = await output.get(name).then(tg.File.expect);
			const metadata = await std.file.executableMetadata(executable);
			tg.assert(
				metadata.format === "mach-o",
				`expected ${target} ${name} to be a Mach-O file`,
			);
			tg.assert(
				metadata.arches.length === 1 && metadata.arches[0] === arch,
				`expected ${target} ${name} to be ${arch}, got ${metadata.arches.join(", ")}`,
			);
			const dependencies = metadata.dependencies ?? [];
			for (const dependency of expectedDependencies) {
				tg.assert(
					dependencies.includes(dependency),
					`expected ${target} ${name} to depend on ${dependency}, got ${dependencies.join(", ")}`,
				);
			}
			// The linker signs arm64 output ad hoc, because macOS refuses to run unsigned arm64 code.
			if (arch === "aarch64") {
				const parsed = await macho.parse(executable);
				tg.assert(!("files" in parsed));
				tg.assert(
					parsed.loadCommands.some((command) => command.cmd === 0x1d),
					`expected ${target} ${name} to carry an LC_CODE_SIGNATURE load command`,
				);
			}
		}
		results[target] = output;
	}
	return tg.directory(results);
}

export function llvmMajorVersion() {
	return metadata.version.split(".")[0];
}

type WrapArgsArg = {
	host: string;
	target?: string;
	toolchainDir: tg.Directory;
};

/** Produce the flags and environment required to properly proxy this toolchain. */
export async function wrapArgs(arg: WrapArgsArg) {
	const { host, target: target_, toolchainDir } = arg;
	const target = target_ ?? host;

	let clangArgs: tg.Args<tg.Template.Arg> = [];
	let clangxxArgs: tg.Args<tg.Template.Arg> = [];
	let env = {};
	if (std.triple.os(host) === "darwin") {
		const targetOs = std.triple.os(target);
		if (targetOs === "darwin") {
			// If the target is darwin, use the macOS SDK for the SDKROOT.
			env = {
				MACOSX_DEPLOYMENT_TARGET: tg.Mutation.setIfUnset(
					std.sdk.macOsDeploymentTarget,
				),
				SDKROOT: tg.Mutation.setIfUnset(
					tg`${bootstrap.macOsSdk(undefined, host)}/MacOSX.sdk`,
				),
			};
		} else if (targetOs === "linux") {
			// If the target is linux, unset any existing SDKROOT and instead use the Linux sysroot.
			env = {
				SDKROOT: tg.Mutation.unset(),
			};
			const targetSysroot = getLinuxSysroot(target);
			clangArgs.push(
				"-target",
				target,
				tg`--sysroot=${targetSysroot}`,
				"-rtlib=libgcc",
				"-unwindlib=libgcc",
			);
		} else {
			return tg.unimplemented(`unrecognized target OS: ${targetOs}`);
		}
		clangxxArgs = [...clangArgs];
	} else if (host !== target) {
		// The `${target}-` drivers already carry the target, its sysroot, and the runtime flags that go with it.
	} else {
		// Define common flags.
		const commonFlags = ["-rtlib=compiler-rt", tg`--sysroot=${toolchainDir}`];

		// Set C flags.
		clangArgs = clangArgs.concat(commonFlags);

		// Set C++ flags.
		const cxxFlags = ["--stdlib=libc++", "-lc++", "-unwindlib=libunwind"];
		clangxxArgs = clangxxArgs.concat(commonFlags, cxxFlags);
	}

	return { clangArgs, clangxxArgs, env };
}

export async function getLinuxSysroot(target: string): Promise<tg.Directory> {
	const url = `https://github.com/tangramdotdev/bootstrap/releases/download/v2024.10.03/${target}-sysroot.tar.zst`;

	const checksums: Record<string, tg.Checksum> = {
		"aarch64-unknown-linux-gnu":
			"sha256:36d4a5a5b7e7e742c17a1c42fcb12814a20e365b8d51074f0d0d447ac9a8a0e4",
		"aarch64-unknown-linux-musl":
			"sha256:ee1a3b20498ee0f20655215821aceb97a45ac3a0b13bfb811fe8c65a690b823c",
		"x86_64-unknown-linux-gnu":
			"sha256:d41a894b08652f614f50ee0e663fe8570e507d63bc293a75e79c52284c83d1fa",
		"x86_64-unknown-linux-musl":
			"sha256:63672e1874978c823939b9ecd9050d878abd068f52a6ecf5a5c7d0ed46be0006",
	};
	const checksum = checksums[target];
	tg.assert(checksum);
	// Use the builtin extractor to reject case-conflicting headers on case-insensitive filesystems.
	return await tg
		.download(url, checksum, { mode: "extract" })
		.then(tg.Directory.expect);
}

/** Check whether the filesystem supports a Linux sysroot before running a cross-compilation test. */
export async function canExtractLinuxSysroot(target: string): Promise<boolean> {
	try {
		await getLinuxSysroot(target);
		return true;
	} catch (error) {
		// Only the case-conflict diagnostic makes this target unsupported.
		for (
			let cause = error;
			cause instanceof tg.Error;
			cause = (await cause.source)?.node
		) {
			if (
				(await cause.message) ===
				"an entry whose name differs only in case already exists, and the file system is case insensitive"
			) {
				return false;
			}
		}
		throw error;
	}
}

export async function testLinuxSysroot() {
	const target = "x86_64-unknown-linux-gnu";
	if (!(await canExtractLinuxSysroot(target))) {
		console.log(
			"verified that the sysroot extractor rejects case-conflicting headers",
		);
		return true;
	}
	const directory = await getLinuxSysroot(target);
	const upper = await directory
		.get("include/linux/netfilter/xt_TCPMSS.h")
		.then(tg.File.expect);
	const lower = await directory
		.get("include/linux/netfilter/xt_tcpmss.h")
		.then(tg.File.expect);
	tg.assert((await upper.text).includes("struct xt_tcpmss_info"));
	tg.assert((await lower.text).includes("struct xt_tcpmss_match_info"));
	return true;
}

export async function test() {
	// Build a triple for the detected host.
	const host = std.sdk.canonicalTriple(std.triple.host());
	const hostArch = std.triple.arch(host);
	const system = std.triple.archAndOs(host);
	const os = std.triple.os(system);

	const expectedInterpreterName =
		os === "darwin" ? undefined : libc.interpreterName(host);

	const directory = await toolchain({ host });
	tg.Directory.assert(directory);
	await directory.store();
	console.log("toolchain dir", directory.id);
	const env =
		os === "darwin"
			? {
					MACOSX_DEPLOYMENT_TARGET: std.sdk.macOsDeploymentTarget,
					SDKROOT: tg`${bootstrap.macOsSdk(undefined, host)}/MacOSX.sdk`,
				}
			: {};

	const testCSource = tg.file`
		#include <stdio.h>
		int main() {
			printf("Hello, world!\\n");
			return 0;
		}`;
	const linkerFlags = os === "linux" ? "-fuse-ld=lld" : "";
	const unwindFlags = os === "linux" ? "-unwindlib=libunwind" : "";
	const cOut = await $(std.shBootstrap`
		set -x && clang -v -xc ${testCSource} ${linkerFlags} -o ${tg.output}
	`)
		.env(directory, env)
		.host(system)
		.then(tg.File.expect);

	const cMetadata = await std.file.executableMetadata(cOut);
	if (os === "linux") {
		tg.assert(cMetadata.format === "elf");
		tg.assert(
			expectedInterpreterName !== undefined
				? cMetadata.interpreter?.includes(expectedInterpreterName)
				: cMetadata.interpreter === undefined,
			`expected ${expectedInterpreterName}, got ${cMetadata.interpreter}`,
		);
	} else if (os === "darwin") {
		tg.assert(cMetadata.format === "mach-o");
		tg.assert(
			cMetadata.arches.length === 1 && cMetadata.arches[0] === hostArch,
		);
	}

	const testCXXSource = tg.file`
		#include <iostream>
		int main() {
			std::cout << "Hello, world!" << std::endl;
			return 0;
		}
	`;
	const cxxOut = await $(std.shBootstrap`
		set -x && clang++ -v -xc++ ${testCXXSource} -stdlib=libc++ -lc++ ${linkerFlags} ${unwindFlags} -o ${tg.output}
	`)
		.env(directory, env)
		.host(system)
		.then(tg.File.expect);

	const cxxMetadata = await std.file.executableMetadata(cxxOut);
	if (os === "linux") {
		tg.assert(cxxMetadata.format === "elf");
		tg.assert(
			expectedInterpreterName !== undefined
				? cxxMetadata.interpreter?.includes(expectedInterpreterName)
				: cxxMetadata.interpreter === undefined,
			`expected ${expectedInterpreterName}, got ${cxxMetadata.interpreter}`,
		);
	} else if (os === "darwin") {
		tg.assert(cxxMetadata.format === "mach-o");
		tg.assert(
			cxxMetadata.arches.length === 1 && cxxMetadata.arches[0] === hostArch,
		);
	}

	return directory;
}
