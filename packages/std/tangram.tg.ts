export * as assert from "./assert.tg.ts";
export * as autotools from "./autotools.tg.ts";
export { build } from "./build.tg.ts";
export { caCertificates } from "./certificates.tg.ts";
export { image } from "./image.tg.ts";
export * as directory from "./directory.tg.ts";
export { download } from "tg:download" with { path: "./download" };
export { env } from "./env.tg.ts";
export * as file from "./file.tg.ts";
export { patch } from "./patch.tg.ts";
export * as phases from "./phases.tg.ts";
export { sdk } from "./sdk.tg.ts";
export * as triple from "./triple.tg.ts";
export * as utils from "./utils.tg.ts";
export { default as wrap } from "./wrap.tg.ts";

export let metadata = {
	name: "std",
	version: "0.0.0",
};

export let flatten = <T>(value: tg.MaybeNestedArray<T>): Array<T> => {
	// @ts-ignore
	return value instanceof Array ? value.flat(Infinity) : [value];
};

export let test = tg.target(() => testDefaultSdk());

import * as triple from "./triple.tg.ts";
export let testHostSystem = tg.target(async () => {
	return triple.host();
});
export let testTriple = tg.target(async () => {
	return await triple.test();
});

// std.wrap component tests

import * as injection from "./wrap/injection.tg.ts";
export let testCompileInjection = tg.target(async () => {
	return await injection.test();
});
export let testCompileInjectionCross = tg.target(async () => {
	return await injection.testCross();
});

import * as workspace from "./wrap/workspace.tg.ts";

export let testEarlyRust = tg.target(async () => {
	return await workspace.rust();
});

export let testWorkspace = tg.target(async () => {
	return await workspace.test();
});
export let testWorkspaceCross = tg.target(async () => {
	return await workspace.testCross();
});

import * as proxy from "./sdk/proxy.tg.ts";
export let testProxy = tg.target(async () => {
	let file = await proxy.test();
	return file;
});

import * as bootstrap from "./bootstrap.tg.ts";
export let testBootstrap = tg.target(async () => {
	return await bootstrap.test();
});
export let testBootstrapShell = tg.target(async () => {
	return await bootstrap.shell();
});
export let testBootstrapUtils = tg.target(async () => {
	return await bootstrap.utils();
});
export let testBootstrapToolchain = tg.target(async () => {
	return await bootstrap.toolchain();
});
export let testBootstrapMacosSdk = tg.target(async () => {
	return await bootstrap.macOsSdk();
});
export let testAllBootstrapComponents = tg.target(async () => {
	let shell = await bootstrap.shell();
	let utils = await bootstrap.utils();
	let toolchain = await bootstrap.toolchain();
	let macOsSdk = await bootstrap.macOsSdk();
	return [shell, utils, toolchain, macOsSdk];
});
export let testPlainBootstrapSdk = tg.target(async () => {
	let bootstrapSdk = await bootstrap.sdk.env();
	return bootstrapSdk;
});

import { testSingleArgObjectNoMutations, wrap } from "./wrap.tg.ts";
export let testWrap = tg.target(async () => {
	let shell = await bootstrap.shell();
	let exe = tg.File.expect(await shell.get("bin/dash"));
	return await wrap(exe, { env: { HELLO: tg.Mutation.set(`hi`) } });
});
export let testMuslWrapper = tg.target(async () => {
	return await testSingleArgObjectNoMutations();
});

import * as bootstrapMake from "./bootstrap/make.tg.ts";
export let testBootstrapMake = tg.target(async () => {
	return await bootstrapMake.build();
});

export let testBootstrapMusl = tg.target(async () => {
	return await bootstrap.musl.build();
});

// std.utils tests

import * as utils from "./utils.tg.ts";
export let testUtilsPrerequisites = tg.target(async () => {
	return await utils.prerequisites(
		bootstrap.toolchainTriple(await triple.host()),
	);
});

export let testUtilsBash = tg.target(async () => {
	return await utils.bash.test();
});
export let testUtilsCoreutils = tg.target(async () => {
	return await utils.coreutils.test();
});
export let testStaticGnuEnv = tg.target(async () => {
	return await utils.coreutils.gnuEnv();
});
export let testUtilsLibiconv = tg.target(async () => {
	return await utils.libiconv.test();
});
export let testUtilsAttr = tg.target(async () => {
	return await utils.attr.test();
});
export let testUtilsBzip2 = tg.target(async () => {
	return await utils.bzip2.test();
});
export let testUtilsDiffutils = tg.target(async () => {
	return await utils.diffutils.test();
});
export let testUtilsFindutils = tg.target(async () => {
	return await utils.findutils.test();
});
export let testUtilsGawk = tg.target(async () => {
	return await utils.gawk.test();
});
export let testUtilsGrep = tg.target(async () => {
	return await utils.grep.test();
});
export let testUtilsGzip = tg.target(async () => {
	return await utils.gzip.test();
});
export let testUtilsMake = tg.target(async () => {
	return await utils.make.test();
});
export let testUtilsPatch = tg.target(async () => {
	return await utils.patch.test();
});
export let testUtilsSed = tg.target(async () => {
	return await utils.sed.test();
});
export let testUtilsTar = tg.target(async () => {
	return await utils.tar.test();
});
export let testUtilsXz = tg.target(async () => {
	return await utils.xz.test();
});
export let testUtils = tg.target(async () => {
	return await utils.test();
});

// sdk dependencies tests

import * as dependencies from "./sdk/dependencies.tg.ts";
export let testDepsBison = tg.target(async () => {
	return await dependencies.bison.test();
});
export let testDepsm4 = tg.target(async () => {
	return await dependencies.m4.test();
});
export let testDepsPerl = tg.target(async () => {
	return await dependencies.perl.test();
});
export let testDepsPython = tg.target(async () => {
	return await dependencies.python.test();
});
export let testDepsZlib = tg.target(async () => {
	return await dependencies.zlib.test();
});
export let testDepsZstd = tg.target(async () => {
	return await dependencies.zstd.test();
});

// sdk stage tests

import * as kernelHeaders from "./sdk/kernel_headers.tg.ts";
export let testKernelHeaders = tg.target(async () => {
	return await kernelHeaders.test();
});

import * as binutils from "./sdk/binutils.tg.ts";
export let testBinutilsSource = tg.target(async () => {
	return await binutils.source(await triple.host());
});
export let testBinutils = tg.target(async () => {
	return await binutils.test();
});

import * as gcc from "./sdk/gcc.tg.ts";
export let testGccSource = tg.target(async () => {
	return await gcc.source();
});

import {
	testCanadianCross,
	testCross,
	testCrossRpi,
	testStage1,
} from "./sdk/gcc/toolchain.tg.ts";
export let stage1 = tg.target(async () => {
	await testStage1();
	return true;
});
export let canadianCross = tg.target(async () => {
	return testCanadianCross();
});

export let testCrossToolchain = tg.target(() => {
	return testCross();
});
export let testCrossToolchainRpi = tg.target(() => {
	return testCrossRpi();
});

// SDK tests.

import { sdk, assertAllSdks } from "./sdk.tg.ts";
export let testBootstrapSdk = tg.target(async () => {
	return await bootstrap.sdk.test();
});

export let testDefaultSdk = tg.target(async () => {
	let env = await sdk();
	let detectedHost = await triple.host();
	await sdk.assertValid(env, { host: detectedHost });
	return env;
});

export let testAllSdks = tg.target(async () => {
	await assertAllSdks();
	return true;
});

// Post-native SDK component tests.

import * as cmake from "./sdk/cmake.tg.ts";
export let testCmake = tg.target(async () => {
	return await cmake.test();
});

import * as ninja from "./sdk/ninja.tg.ts";
export let testNinja = tg.target(async () => {
	return await ninja.test();
});

import * as mold from "./sdk/mold.tg.ts";
export let testMoldBuild = tg.target(async () => {
	return await mold.test();
});

import * as ncurses from "./sdk/llvm/ncurses.tg.ts";
export let testNcurses = tg.target(async () => {
	return await ncurses.test();
});

import {
	testExplicitGlibcVersionSdk,
	testLLVMMoldSdk,
	testLLVMMuslSdk,
	testLLVMSdk,
	testMoldSdk,
	testMuslSdk,
	testNativeProxiedSdks,
} from "./sdk.tg.ts";
export let testMold = tg.target(async () => {
	return await testMoldSdk();
});
export let testMusl = tg.target(async () => {
	return await testMuslSdk();
});
export let testExplicitGlibcVersion = tg.target(async () => {
	return await testExplicitGlibcVersionSdk();
});

import * as git from "./sdk/llvm/git.tg.ts";
export let testGit = tg.target(async () => {
	return await git.test();
});

import * as llvm from "./sdk/llvm.tg.ts";
export let llvmSource = tg.target(async () => {
	return await llvm.source();
});
export let testLlvmToolchain = tg.target(async () => {
	return await llvm.test();
});
export let testLlvm = tg.target(async () => {
	return await testLLVMSdk();
});
export let testLlvmMold = tg.target(async () => {
	return await testLLVMMoldSdk();
});
export let testLlvmMusl = tg.target(async () => {
	return await testLLVMMuslSdk();
});

export let testNative = tg.target(async () => {
	return await testNativeProxiedSdks();
});

// Image tests.

import * as image from "./image.tg.ts";
export let testOciWrappedEntrypoint = tg.target(async () => {
	return await image.testWrappedEntrypoint();
});
export let testOciBasicRootfs = tg.target(async () => {
	return await image.testBasicRootfs();
});
export let testOciBasicEnv = tg.target(async () => {
	return await image.testOciBasicEnv();
});
export let testOciBasicEnvImage = tg.target(async () => {
	return await image.testBasicEnvImage();
});

import { env } from "./env.tg.ts";
export let testMemory = tg.target(async () => {
	let sdkEnv = bootstrap.sdk();
	let source = (i: number) =>
		tg.file(`
		#include <stdio.h>
		int main() {
			printf("Hello, ${i}!\\n");
			return 0;
		}
	`);
	let jobs = [];
	for (let i = 0; i < 1000; i++) {
		jobs.push(
			tg.build(tg`cc -xc ${source(i)} -o $OUTPUT`, {
				env: await env.object(sdkEnv),
			}),
		);
	}
	let results = await Promise.all(
		jobs.map(async (job) => await tg.File.expect(await job).id()),
	);
	return results;
});
