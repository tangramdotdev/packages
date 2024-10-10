export * as args from "./args.tg.ts";
export { type Args } from "./args.tg.ts";
export * as assert from "./assert.tg.ts";
export * as autotools from "./autotools.tg.ts";
export { caCertificates } from "./certificates.tg.ts";
export { image } from "./image.tg.ts";
export * as directory from "./directory.tg.ts";
export { $ } from "./dollar.tg.ts";
export { download } from "./download.tg.ts";
export { env } from "./env.tg.ts";
export * as file from "./file.tg.ts";
export { patch } from "./patch.tg.ts";
export * as phases from "./phases.tg.ts";
export { sdk } from "./sdk.tg.ts";
export * as triple from "./triple.tg.ts";
export * as utils from "./utils.tg.ts";
export { wrap } from "./wrap.tg.ts";

export const metadata = {
	name: "std",
	version: "0.0.0",
};

export const flatten = <T>(value: tg.MaybeNestedArray<T>): Array<T> => {
	if (value instanceof Array) {
		// @ts-ignore
		return value.flat(Number.POSITIVE_INFINITY);
	} else {
		return [value];
	}
};

export const test = tg.target(() => testDefaultSdk());

export default test;

export const testTgTag = tg.target(async () => {
	return await tg`hi!`;
});

import * as triple from "./triple.tg.ts";
export const testHostSystem = tg.target(async () => {
	return triple.host();
});
export const testTriple = tg.target(async () => {
	return await triple.test();
});

export const testTgDownload = tg.target(async () => {
	return await tg.download(
		"https://github.com/tangramdotdev/bootstrap/releases/download/v2024.06.20/dash_universal_darwin.tar.zst",
		"unsafe",
	);
});

import { download as stdDownload } from "./download.tg.ts";
export const testStdDownload = tg.target(async () => {
	return await stdDownload({
		url: "https://github.com/tangramdotdev/bootstrap/releases/download/v2024.06.20/dash_universal_darwin.tar.zst",
		checksum: "unsafe",
	});
});
// std.wrap component tests

import * as injection from "./wrap/injection.tg.ts";
export const testCompileInjection = tg.target(async () => {
	return await injection.test();
});
export const testCompileInjectionCross = tg.target(async () => {
	return await injection.testCross();
});

import * as workspace from "./wrap/workspace.tg.ts";

export const testEarlyRust = tg.target(async () => {
	return await workspace.rust();
});

export const testWorkspace = tg.target(async () => {
	return await workspace.test();
});
export const testWorkspaceCross = tg.target(async () => {
	return await workspace.testCross();
});

import * as proxy from "./sdk/proxy.tg.ts";
export const testProxy = tg.target(async () => {
	const file = await proxy.test();
	return file;
});

import * as bootstrap from "./bootstrap.tg.ts";
export const testBootstrap = tg.target(async () => {
	return await bootstrap.test();
});
export const testBootstrapShell = tg.target(async () => {
	return await bootstrap.shell();
});
export const testBootstrapUtils = tg.target(async () => {
	return await bootstrap.utils();
});
export const testGetFromUtils = tg.target(async () => {
	let utils = await bootstrap.utils();
	// get something that exists.
	let busybox = await utils.tryGet("bin/busybox");
	console.log(busybox);

	// get something that doesn't.
	let nothing = await utils.tryGet(".tangram/env");
	console.log(nothing);

	return true;
});
export const testBootstrapToolchain = tg.target(async () => {
	return await bootstrap.toolchain();
});
export const testBootstrapMacosSdk = tg.target(async () => {
	return await bootstrap.macOsSdk();
});
export const testAllBootstrapComponents = tg.target(async () => {
	const shell = await bootstrap.shell();
	const utils = await bootstrap.utils();
	const toolchain = await bootstrap.toolchain();
	const macOsSdk = await bootstrap.macOsSdk();
	return [shell, utils, toolchain, macOsSdk];
});

import * as phases from "./phases.tg.ts";
export const testPhasesBasic = tg.target(async () => {
	return await phases.basicTest();
});
export const testPhasesOverride = tg.target(async () => {
	return await phases.overrideTest();
});
export const testPhasesEnv = tg.target(async () => {
	return await phases.envTest();
});

import {
	testSingleArgObjectNoMutations,
	testReferences,
	testDylibPath,
	wrap,
} from "./wrap.tg.ts";
export const testWrap = tg.target(async () => {
	const shell = await bootstrap.shell();
	const exe = tg.File.expect(await shell.get("bin/dash"));
	return await wrap(exe, { env: { HELLO: tg.Mutation.set(`hi`) } });
});
export const testWrapReferences = tg.target(async () => {
	return await testReferences();
});
export const testWrapDylibPath = tg.target(async () => {
	return await testDylibPath();
});
export const testMuslWrapper = tg.target(async () => {
	return await testSingleArgObjectNoMutations();
});

import * as bootstrapMake from "./bootstrap/make.tg.ts";
export const testBootstrapMake = tg.target(async () => {
	return await bootstrapMake.build();
});

export const testBootstrapMusl = tg.target(async () => {
	return await bootstrap.musl.build();
});

// std.utils tests

import * as utils from "./utils.tg.ts";
export const testUtilsPrerequisites = tg.target(async () => {
	return await utils.prerequisites(
		bootstrap.toolchainTriple(await triple.host()),
	);
});

export const testUtilsBash = tg.target(async () => {
	return await utils.bash.test();
});
export const testUtilsBashSource = tg.target(async () => {
	return await utils.bash.source();
});
export const testUtilsCoreutils = tg.target(async () => {
	return await utils.coreutils.test();
});
export const testUtilsCoreutilsSource = tg.target(async () => {
	return await utils.coreutils.source(triple.os(await triple.host()));
});
export const testStaticGnuEnv = tg.target(async () => {
	return await utils.coreutils.gnuEnv();
});
export const testUtilsLibiconv = tg.target(async () => {
	return await utils.libiconv.test();
});
export const testUtilsAttr = tg.target(async () => {
	return await utils.attr.test();
});
export const testUtilsBzip2 = tg.target(async () => {
	return await utils.bzip2.test();
});
export const testUtilsDiffutils = tg.target(async () => {
	return await utils.diffutils.test();
});
export const testUtilsFindutils = tg.target(async () => {
	return await utils.findutils.test();
});
export const testUtilsGawk = tg.target(async () => {
	return await utils.gawk.test();
});
export const testUtilsGrep = tg.target(async () => {
	return await utils.grep.test();
});
export const testUtilsGzip = tg.target(async () => {
	return await utils.gzip.test();
});
export const testUtilsMake = tg.target(async () => {
	return await utils.make.test();
});
export const testUtilsPatch = tg.target(async () => {
	return await utils.patch.test();
});
export const testUtilsSed = tg.target(async () => {
	return await utils.sed.test();
});
export const testUtilsTar = tg.target(async () => {
	return await utils.tar.test();
});
export const testUtilsXz = tg.target(async () => {
	return await utils.xz.test();
});
export const testUtils = tg.target(async () => {
	return await utils.test();
});

// sdk dependencies tests

import * as dependencies from "./sdk/dependencies.tg.ts";
export const testDepsBison = tg.target(async () => {
	return await dependencies.bison.test();
});
export const testDepsGmp = tg.target(async () => {
	return await dependencies.gmp.test();
});
export const testDepsm4 = tg.target(async () => {
	return await dependencies.m4.test();
});
export const testDepsPerl = tg.target(async () => {
	return await dependencies.perl.test();
});
export const testDepsPython = tg.target(async () => {
	return await dependencies.python.test();
});
export const testDepsZlib = tg.target(async () => {
	return await dependencies.zlib.test();
});
export const testDepsZstd = tg.target(async () => {
	return await dependencies.zstd.test();
});

// sdk stage tests

import * as kernelHeaders from "./sdk/kernel_headers.tg.ts";
export const testKernelHeaders = tg.target(async () => {
	return await kernelHeaders.test();
});

import * as binutils from "./sdk/gnu/binutils.tg.ts";
export const testBinutilsSource = tg.target(async () => {
	return await binutils.source(await triple.host());
});
export const testBinutils = tg.target(async () => {
	return await binutils.test();
});

import * as gcc from "./sdk/gnu/gcc.tg.ts";
export const testGccSource = tg.target(async () => {
	return await gcc.source();
});

import {
	testCanadianCross,
	testCross,
	testCrossMips,
	testCrossRpi,
} from "./sdk/gnu/toolchain.tg.ts";
export const canadianCross = tg.target(async () => {
	return testCanadianCross();
});
export const testCrossToolchain = tg.target(() => {
	return testCross();
});
export const testCrossToolchainMips = tg.target(() => {
	return testCrossMips();
});
export const testCrossToolchainRpi = tg.target(() => {
	return testCrossRpi();
});

// SDK tests.

import {
	sdk,
	assertAllSdks,
	testDarwinToLinux as testDarwinToLinux_,
	testLinuxToDarwin as testLinuxToDarwin_,
} from "./sdk.tg.ts";
export const testBootstrapSdk = tg.target(async () => {
	return await bootstrap.sdk.test();
});

export const testDefaultSdk = tg.target(async () => {
	const env = await sdk();
	const detectedHost = await triple.host();
	await sdk.assertValid(env, { host: detectedHost });
	return env;
});

export const testDarwinToLinux = tg.target(async () => {
	return testDarwinToLinux_();
});
export const testLinuxToDarwin = tg.target(async () => {
	return testLinuxToDarwin_();
});
import { testLinuxToDarwin as testLinuxToDarwinToolchain_ } from "./sdk/llvm.tg.ts";
export const testLinuxToDarwinToolchain = tg.target(async () => {
	return await testLinuxToDarwinToolchain_({
		host: await triple.host(),
		target: "aarch64-apple-darwin",
	});
});
export const testAllSdks = tg.target(async () => {
	await assertAllSdks();
	return true;
});

// Post-native SDK component tests.

import * as cmake from "./sdk/cmake.tg.ts";
export const testCmake = tg.target(async () => {
	return await cmake.test();
});

import * as ninja from "./sdk/ninja.tg.ts";
export const testNinja = tg.target(async () => {
	return await ninja.test();
});

import * as mold from "./sdk/mold.tg.ts";
export const testMoldBuild = tg.target(async () => {
	return await mold.test();
});

import * as ncurses from "./sdk/llvm/ncurses.tg.ts";
export const testNcurses = tg.target(async () => {
	return await ncurses.test();
});

import {
	testExplicitGlibcVersionSdk,
	testCrossGccSdk,
	testGccLldSdk,
	testLLVMBfdSdk,
	testLLVMMoldSdk,
	testLLVMMuslSdk,
	testLLVMSdk,
	testMoldSdk,
	testMuslSdk,
	testNativeProxiedSdks,
} from "./sdk.tg.ts";
export const testGccLld = tg.target(async () => {
	return await testGccLldSdk();
});
export const testMold = tg.target(async () => {
	return await testMoldSdk();
});
export const testMusl = tg.target(async () => {
	return await testMuslSdk();
});
export const testExplicitGlibcVersion = tg.target(async () => {
	return await testExplicitGlibcVersionSdk();
});
export const testCrossGcc = tg.target(async () => {
	return await testCrossGccSdk();
});

import * as git from "./sdk/llvm/git.tg.ts";
export const testGit = tg.target(async () => {
	return await git.test();
});

import * as llvm from "./sdk/llvm.tg.ts";
export const llvmSource = tg.target(async () => {
	return await llvm.source();
});
export const testLlvmToolchain = tg.target(async () => {
	return await llvm.test();
});
export const testLlvm = tg.target(async () => {
	return await testLLVMSdk();
});
export const testLlvmBfd = tg.target(async () => {
	return await testLLVMBfdSdk();
});
export const testLlvmMold = tg.target(async () => {
	return await testLLVMMoldSdk();
});
export const testLlvmMusl = tg.target(async () => {
	return await testLLVMMuslSdk();
});

export const testNative = tg.target(async () => {
	return await testNativeProxiedSdks();
});

// Image tests.

import * as image from "./image.tg.ts";
export const testOciWrappedEntrypoint = tg.target(async () => {
	return await image.testWrappedEntrypoint();
});
export const testOciBasicRootfs = tg.target(async () => {
	return await image.testBasicRootfs();
});
export const testOciBasicEnv = tg.target(async () => {
	return await image.testOciBasicEnv();
});
export const testOciBasicEnvImageDocker = tg.target(async () => {
	return await image.testBasicEnvImageDocker();
});
export const testOciBasicEnvImageOci = tg.target(async () => {
	return await image.testBasicEnvImageOci();
});

import { test as testDollar_ } from "./dollar.tg.ts";
export const testDollar = tg.target(async () => {
	return await testDollar_();
});

import { env as stdEnv } from "./env.tg.ts";
export const testBaseEnv = tg.target(async () => {
	return await stdEnv({ FOO: "bar" });
});

import * as libtapi from "./sdk/llvm/apple_libtapi.tg.ts";
export const testLibtapi = tg.target(async () => {
	return await libtapi.build();
});

import * as cctools from "./sdk/llvm/cctools_port.tg.ts";
export const testCctoolsPort = tg.target(async () => {
	return await cctools.build();
});

import * as libdispatch from "./sdk/llvm/apple_libdispatch.tg.ts";
export const testLibdispatch = tg.target(async () => {
	return await libdispatch.build();
});

import * as libbsd from "./sdk/llvm/libbsd.tg.ts";
export const testLibbsd = tg.target(async () => {
	return await libbsd.build();
});

import * as libmd from "./sdk/llvm/libmd.tg.ts";
export const testLibmd = tg.target(async () => {
	return await libmd.build();
});

export const testStrip = tg.target(async () => {
	return await proxy.testStrip();
});

import testSource from "./wrap/test/inspectProcess.c" with { type: "file" };
export const testCheckoutWrapper = tg.target(async () => {
	const env = stdEnv.arg(bootstrap.sdk());
	let output = await tg
		.target(tg`cc -o $OUTPUT -xc ${testSource}`, { env })
		.then((t) => t.output())
		.then(tg.File.expect);
	let outputId = await output.id();
	console.log("output id", outputId);
	let testInTg = await tg
		.target(tg`${output} | tee $OUTPUT`, { env })
		.then((t) => t.output())
		.then(tg.File.expect);
	let testInTgText = await testInTg.contents().then((b) => b.text());
	console.log("testInTg contents", testInTgText);
	return output;
});

import { testKeepSubdirectories as testKeepSubdirectories_ } from "./directory.tg.ts";
export const testKeepSubdirectories = tg.target(async () => {
	return await testKeepSubdirectories_();
});
