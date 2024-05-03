import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.tg.ts";
import * as cmake from "./cmake.tg.ts";
import * as dependencies from "./dependencies.tg.ts";
import git from "./git.tg.ts";
import * as libc from "./libc.tg.ts";
import ncurses from "./llvm/ncurses.tg.ts";
import { buildToHostCrossToolchain } from "./gcc/toolchain.tg.ts";

export let metadata = {
	homepage: "https://llvm.org/",
	name: "llvm",
	license:
		"https://github.com/llvm/llvm-project/blob/991cfd1379f7d5184a3f6306ac10cabec742bbd2/LICENSE.TXT",
	repository: "https://github.com/llvm/llvm-project/",
	version: "18.1.5",
};

export let source = async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:3591a52761a7d390ede51af01ea73abfecc4b1d16445f9d019b67a57edd7de56";
	let owner = name;
	let repo = "llvm-project";
	let tag = `llvmorg-${version}`;
	let extension = ".tar.xz";
	let url = `https://github.com/${owner}/${repo}/releases/download/${tag}/${repo}-${version}.src${extension}`;
	let outer = tg.Directory.expect(await std.download({ checksum, url }));
	return std.directory.unwrap(outer);
};

export type LLVMArg = std.sdk.BuildEnvArg & {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	source?: tg.Directory;
};

export let toolchain = tg.target(async (arg?: LLVMArg) => {
	let {
		autotools = [],
		build: build_,
		env: env_,
		host: host_,
		source: source_,
		...rest
	} = arg ?? {};
	let host = std.sdk.canonicalTriple(host_ ?? (await std.triple.host()));
	let build = build_ ?? host;

	if (std.triple.os(host) === "darwin") {
		// On macOS, just return the bootstrap toolchain, which provides Apple Clang.
		return bootstrap.sdk.env(host);
	}

	let sourceDir = source_ ?? source();

	// Use the internal GCC bootstrapping function to avoid needlesssly rebuilding glibc.
	let { sysroot } = await buildToHostCrossToolchain(host);
	// The buildSysroot helper nests the sysroot under a triple-named directory. Extract the inner dir.
	sysroot = tg.Directory.expect(await sysroot.get(host));
	console.log("llvm sysroot", await sysroot.id());

	// Define build environment.
	let ncursesArtifact = ncurses({ host: build });
	let zlibArtifact = dependencies.zlib.build({ host: build });
	let deps = [
		git({ host: build }),
		dependencies.python.build({
			host: build,
			sdk: bootstrap.sdk.arg(build),
		}),
		ncursesArtifact,
		zlibArtifact,
	];

	let env = [...deps, env_];

	let ldsoName = libc.interpreterName(host);
	// Ensure that stage2 unproxied binaries are runnable during the build, before we have a chance to wrap them post-install.
	let stage2ExeLinkerFlags = tg`-Wl,-dynamic-linker=${sysroot}/lib/${ldsoName} -unwindlib=libunwind`;

	// Grab the cache files.
	let cacheDir = tg.Directory.expect(await tg.include("llvm/cmake"));

	// Ensure that stage2 unproxied binaries are able to locate libraries during the build, without hardcoding rpaths. We'll wrap them afterwards.
	let prepare = tg`export LD_LIBRARY_PATH="${sysroot}/lib:${zlibArtifact}/lib:${ncursesArtifact}/lib:$HOME/work/lib:$HOME/work/lib/${host}"`;
	let configure = {
		args: [
			tg`-DBOOTSTRAP_CMAKE_EXE_LINKER_FLAGS='${stage2ExeLinkerFlags}'`,
			tg`-DDEFAULT_SYSROOT=${sysroot}`,
			"-DLLVM_PARALLEL_LINK_JOBS=1",
			tg`-DTerminfo_ROOT=${ncursesArtifact}`,
			// NOTE - CLANG_BOOTSTRAP_PASSTHROUGH didn't work for Terminfo_ROOT, but this did.
			tg`-DBOOTSTRAP_Terminfo_ROOT=${ncursesArtifact}`,
			tg`-DZLIB_ROOT=${zlibArtifact}`,
			`-DCLANG_BOOTSTRAP_PASSTHROUGH="DEFAULT_SYSROOT;LLVM_PARALLEL_LINK_JOBS;ZLIB_ROOT"`,
			"-C",
			tg`${cacheDir}/Distribution.cmake`,
		],
	};

	let buildPhase = tg.Mutation.set("ninja stage2-distribution");
	let install = tg.Mutation.set("ninja stage2-install-distribution");
	let phases = { prepare, configure, build: buildPhase, install };

	let llvmArtifact = await cmake.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			env,
			phases,
			source: tg`${sourceDir}/llvm`,
		},
		autotools,
	);

	// Add sysroot and symlinks.
	llvmArtifact = await tg.directory(llvmArtifact, {
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
	llvmArtifact = await tg.directory(llvmArtifact, sysroot);
	console.log("combined llvm + sysroot", await llvmArtifact.id());

	// The bootstrap compiler was not proxied. Manually wrap the output binaries.

	// Collect all required library paths.
	let libDir = llvmArtifact.get("lib").then(tg.Directory.expect);
	let hostLibDir = tg.symlink(tg`${libDir}/${host}`);
	let ncursesLibDir = ncursesArtifact.then((dir) =>
		dir.get("lib").then(tg.Directory.expect),
	);
	let zlibLibDir = zlibArtifact.then((dir) =>
		dir.get("lib").then(tg.Directory.expect),
	);
	let libraryPaths = [libDir, hostLibDir, ncursesLibDir, zlibLibDir];

	// Wrap all ELF binaries in the bin directory.
	let binDir = await llvmArtifact.get("bin").then(tg.Directory.expect);
	for await (let [name, artifact] of binDir) {
		if (tg.File.is(artifact)) {
			let { format } = await std.file.executableMetadata(artifact);
			if (format === "elf") {
				let unwrapped = binDir.get(name).then(tg.File.expect);
				// Use the wrapper identity to ensure the wrapper is called when binaries call themselves. Otherwise it won't find all required libraries.
				let wrapped = std.wrap(unwrapped, {
					identity: "wrapper",
					libraryPaths,
				});
				llvmArtifact = await tg.directory(llvmArtifact, {
					[`bin/${name}`]: wrapped,
				});
			}
		}
	}

	console.log("wrapped llvm artifact", await llvmArtifact.id());
	return llvmArtifact;
});

export let llvmMajorVersion = () => {
	return metadata.version.split(".")[0];
};

type WrapArgsArg = {
	host: string;
	target?: string;
	toolchainDir: tg.Directory;
};

/** Produce the flags and environment required to properly proxy this toolchain. */
export let wrapArgs = async (arg: WrapArgsArg) => {
	let { host, target: target_, toolchainDir } = arg;
	let target = target_ ?? host;
	let version = llvmMajorVersion();

	let clangArgs: tg.Unresolved<tg.Template.Arg> = [];
	let clangxxArgs: tg.Unresolved<tg.Template.Arg> = [];
	let env = {};
	if (std.triple.os(host) === "darwin") {
		// Note - the Apple Clang version provided by the OS is 15, not ${version}.
		clangArgs.push(tg`-resource-dir=${toolchainDir}/lib/clang/15.0.0`);
		clangxxArgs = [...clangArgs];
		env = {
			SDKROOT: tg.Mutation.setIfUnset(bootstrap.macOsSdk()),
		};
	} else {
		clangArgs.push(tg`-resource-dir=${toolchainDir}/lib/clang/${version}`);
		clangxxArgs.push(tg`-resource-dir=${toolchainDir}/lib/clang/${version}`);
		clangxxArgs.push(tg`-unwindlib=libunwind`);
		clangxxArgs.push(tg`-L${toolchainDir}/lib/${target}`);
		clangxxArgs.push(tg`-isystem${toolchainDir}/include/c++/v1`);
		clangxxArgs.push(tg`-isystem${toolchainDir}/include/${target}/c++/v1`);
	}

	return { clangArgs, clangxxArgs, env };
};

export let test = async () => {
	// Build a triple for the detected host.
	let host = std.sdk.canonicalTriple(await std.triple.host());
	let hostArch = std.triple.arch(host);
	let os = std.triple.os(std.triple.archAndOs(host));

	let libDir = std.triple.environment(host) === "musl" ? "lib" : "lib64";
	let expectedInterpreter =
		os === "darwin" ? undefined : `/${libDir}/${libc.interpreterName(host)}`;

	let directory = await toolchain({ host });

	let testCSource = tg.file(`
		#include <stdio.h>
		int main() {
			printf("Hello, world!\\n");
			return 0;
		}
	`);
	let cScript = tg`
		set -x && clang -v -xc ${testCSource} -fuse-ld=lld -o $OUTPUT
	`;
	let cOut = tg.File.expect(
		await std.build(cScript, {
			env: directory,
			host,
		}),
	);

	let cMetadata = await std.file.executableMetadata(cOut);
	if (os === "linux") {
		tg.assert(cMetadata.format === "elf");
		tg.assert(cMetadata.interpreter === expectedInterpreter);
		tg.assert(cMetadata.arch === hostArch);
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
		set -x && clang++ -v -xc++ ${testCXXSource} -fuse-ld=lld -unwindlib=libunwind -o $OUTPUT
	`;
	let cxxOut = tg.File.expect(
		await std.build(cxxScript, {
			env: [directory],
			host,
		}),
	);

	let cxxMetadata = await std.file.executableMetadata(cxxOut);
	if (os === "linux") {
		tg.assert(cxxMetadata.format === "elf");
		tg.assert(cxxMetadata.interpreter === expectedInterpreter);
		tg.assert(cxxMetadata.arch === hostArch);
	} else if (os === "darwin") {
		tg.assert(cxxMetadata.format === "mach-o");
	}

	return directory;
};
