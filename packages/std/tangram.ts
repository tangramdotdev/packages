export { type Args } from "./args.tg.ts";
export * as args from "./args.tg.ts";
export * as assert from "./assert.tg.ts";
export * as autotools from "./autotools.tg.ts";
export { build } from "./build.tg.ts";
export { caCertificates } from "./certificates.tg.ts";
export { command } from "./command.tg.ts";
export * as dependencies from "./sdk/dependencies.tg.ts";
export { image } from "./image.tg.ts";
export * as directory from "./directory.tg.ts";
export { download } from "./download.tg.ts";
export { env } from "./env.tg.ts";
export * as file from "./file.tg.ts";
export { patch } from "./patch.tg.ts";
export * as packages from "./packages.tg.ts";
export * as phases from "./phases.tg.ts";
export { $, run } from "./run.tg.ts";
export { sdk } from "./sdk.tg.ts";
export * as triple from "./triple.tg.ts";
export * as utils from "./utils.tg.ts";
export { wrap } from "./wrap.tg.ts";
export { stripProxy } from "./sdk/proxy.tg.ts";

import * as bootstrap from "./bootstrap.tg.ts";
import * as bootstrapSdk from "./bootstrap/sdk.tg.ts";
import * as build from "./build.tg.ts";
import caCertificates from "./certificates.tg.ts";
import * as dependencies from "./sdk/dependencies.tg.ts";
import * as directory from "./directory.tg.ts";
import * as download from "./download.tg.ts";
import * as env from "./env.tg.ts";
import { env as stdEnv } from "./env.tg.ts";
import * as file from "./file.tg.ts";
import * as image from "./image.tg.ts";
import * as injection from "./wrap/injection.tg.ts";
import * as phases from "./phases.tg.ts";
import * as run from "./run.tg.ts";
import * as sdk from "./sdk.tg.ts";
import * as triple from "./triple.tg.ts";
import * as utils from "./utils.tg.ts";
import * as workspace from "./wrap/workspace.tg.ts";
import * as wrap from "./wrap.tg.ts";

export const metadata = {
	name: "std",
	version: "0.0.0",
};

/** The default export produces the default SDK env for the detected host, asserts its validity, and uses it to build the standard set of autotools build dependencies, returning the resulting env. */
export const default_ = async () => {
	const host = await triple.host();
	const defaultSdk = await sdk.testDefault();
	const stdUtils = await tg.build(utils.env, {
		env: defaultSdk,
		host,
	});
	const buildTools = await tg.build(dependencies.buildTools, {
		host,
		buildToolchain: stdEnv(defaultSdk, stdUtils),
		level: "extended",
	});
	return stdEnv(stdUtils, defaultSdk, buildTools);
};
export default default_;

/** Mapping of strings to pass to "test" to the test targets they run. */
const testActions = (): Record<string, () => any> => {
	return {
		hostSystem: triple.host,
		triple: triple.test,
		download: download.test,
		phases: phases.test,
		certificates: caCertificates,
		bootstrapShell: bootstrap.shell,
		bootstrapUtils: bootstrap.utils,
		bootstrapToolchain: bootstrap.toolchain,
		bootstrapMacOsSdk: bootstrap.macOsSdk,
		bootstrapComponents: bootstrap.test,
		hostInjection: injection.test,
		earlyRust: workspace.rust,
		workspace: workspace.test,
		bootstrapSdk: bootstrapSdk.test,
		bootstrapMake: bootstrap.make.test,
		bootstrapMusl: bootstrap.musl.build,
		file: file.test,
		fileBinary: file.testBinary,
		fileShebang: file.testShebang,
		directory: directory.test,
		wrapArgAndEnvDump: wrap.argAndEnvDump,
		wrapBasic: wrap.testSingleArgObjectNoMutations,
		wrapContent: wrap.testContentExecutable,
		wrapContentVariadic: wrap.testContentExecutableVariadic,
		wrapDylib: wrap.testDylibPath,
		wrap: wrap.test,
		env: env.test,
		proxyBasic: sdk.proxy.testBasic,
		proxyTransitiveAll: sdk.proxy.testTransitiveAll,
		proxyNone: sdk.proxy.testTransitiveNone,
		proxyFilter: sdk.proxy.testTransitive,
		proxyResolve: sdk.proxy.testTransitiveResolve,
		proxyIsolate: sdk.proxy.testTransitiveIsolate,
		proxyCombine: sdk.proxy.testTransitiveCombine,
		proxySamePrefix: sdk.proxy.testSamePrefix,
		proxySamePrefixDirect: sdk.proxy.testSamePrefixDirect,
		proxyDifferentPrefixDirect: sdk.proxy.testDifferentPrefixDirect,
		proxyStrip: sdk.proxy.testStrip,
		proxySharedWithDep: sdk.proxy.testSharedLibraryWithDep,
		proxy: sdk.proxy.test,
		utilsPrerequisites: utils.testPrerequisites,
		utilsBash: utils.bash.test,
		utilsCoreutils: utils.coreutils.test,
		utilsStaticGnuEnv: utils.coreutils.gnuEnv,
		utilsLibiconv: utils.libiconv.test,
		utilsAttr: utils.attr.test,
		utilsBzip2: utils.bzip2.test,
		utilsDiffutils: utils.diffutils.test,
		utilsFindutils: utils.findutils.test,
		utilsGawk: utils.gawk.test,
		utilsGrep: utils.grep.test,
		utilsGzip: utils.gzip.test,
		utilsMake: utils.make.test,
		utilsPatch: utils.patch.test,
		utilsSed: utils.sed.test,
		utilsTar: utils.tar.test,
		utilsXz: utils.xz.test,
		utils: utils.test,
		kernelHeaders: sdk.kernelHeaders.test,
		binutils: sdk.gnu.binutils.test,
		gccSource: sdk.gnu.gcc.source,
		gnuCanadianCross: sdk.gnu.gnuToolchain.testCanadianCross,
		gnuCross: sdk.gnu.gnuToolchain.testCross,
		gnuSysrootGlibc: sdk.gnu.gnuToolchain.extractSysrootGlibc,
		gnuSysrootMusl: sdk.gnu.gnuToolchain.extractSysrootMusl,
		gnuCrossMips: sdk.gnu.gnuToolchain.testCrossMips,
		gnuCrossRpi: sdk.gnu.gnuToolchain.testCrossRpi,
		llvmGit: sdk.llvm.git.test,
		llvmNcurses: sdk.llvm.ncurses.test,
		llvmSource: sdk.llvm.source,
		llvmToolchain: sdk.llvm.toolchain,
		llvmBuildLLd: sdk.llvm.buildLld,
		llvmAppleLibdispatch: sdk.llvm.appleLibdispatch.build,
		llvmAppleLibtapi: sdk.llvm.appleLibtapi.build,
		llvmLibBsd: sdk.llvm.libBsd.build,
		llvmLibMd: sdk.llvm.libMd.build,
		llvmLinuxToDarwinToolchain: sdk.llvm.testLinuxToDarwin,
		sdkDepsBison: sdk.dependencies.bison.test,
		sdkDepsFlex: sdk.dependencies.flex.test,
		sdkDepsGmp: sdk.dependencies.gmp.test,
		sdkDepsM4: sdk.dependencies.m4.test,
		sdkDepsMpc: sdk.dependencies.mpc.test,
		sdkDepsMpfr: sdk.dependencies.mpfr.test,
		sdkDepsLibxcrypt: sdk.dependencies.libxcrypt.test,
		sdkDepsPerl: sdk.dependencies.perl.test,
		sdkDepsPython: sdk.dependencies.python.test,
		sdkDepsZlib: sdk.dependencies.zlib.test,
		sdkDepsZstd: sdk.dependencies.zlib.test,
		sdkDepsCmake: sdk.cmake.test,
		sdkDepsNinja: sdk.ninja.test,
		sdkDepsMoldSource: sdk.mold.source,
		sdkDepsMold: sdk.mold.test,
		sdkDefault: sdk.testDefault,
		sdkGccCross: sdk.testCrossGcc,
		sdkGccLld: sdk.testGccLld,
		sdkLlvm: sdk.testLLVM,
		sdkLlvmBfd: sdk.testLLVMBfd,
		sdkLlvmMold: sdk.testLLVMMold,
		sdkLLvmMusl: sdk.testLLVMMusl,
		sdkMold: sdk.testMold,
		sdkMusl: sdk.testMusl,
		sdkAllNative: sdk.testAllNativeProxied,
		sdkExplicitGlibcVersion: sdk.testExplicitGlibcVersion,
		sdkDarwinToLinux: sdk.testDarwinToLinux,
		sdkLinuxToDarwin: sdk.testLinuxToDarwin,
		sdkAll: sdk.assertAllSdks,
		crossInjection: injection.testCross,
		crossWorkspace: workspace.testCross,
		imageWrappedEntrypoint: image.testWrappedEntrypoint,
		imageBasicRootfs: image.testBasicRootfs,
		imageBootstrapEnv: image.testBootstrapEnv,
		imageBootstrapEnvImageDocker: image.testBootstrapEnvImageDocker,
		imageBootstrapEnvImageOci: image.testBootstrapEnvImageOci,
		imageBasicEnv: image.testBasicEnv,
		imageBasicEnvImageDocker: image.testBasicEnvImageDocker,
		imageBasicEnvImageOci: image.testBasicEnvImageOci,
		image: image.test,
		stdBuild: build.testBuild,
		stdBuildBootstrap: build.testBuildBootstrap,
		dollar: run.testDollar,
		dollarBootstrap: run.testDollarBootstrap,
		dollarEnvClear: run.testEnvClear,
	};
};

/** A subset of all defined tests to run in the correct order. */
const defaultTests = [
	"hostSystem",
	"triple",
	"certificates",
	"proxy",
	"file",
	"wrap",
	"sdkDefault",
	"dollar",
];

/** With no arguments, runs a set of default tests. Pass test names to run individual component tests. */
export const test = async (...tests: Array<string>) => {
	if (tests.length === 0) {
		tests = defaultTests;
	}
	tests = validateTestNames(...tests);
	console.log("Running tests: ", tests.join(", "));

	let results: Record<string, tg.Value> = {};
	const actionsTable = testActions();
	for (const testName of tests) {
		const func = actionsTable[testName];
		if (func === undefined) {
			return tg.unreachable(`no such test: ${testName}`);
		}
		const result = await tg.build(func);
		console.log(await tg`${testName}: ${result}`);
		results[testName] = result;
	}

	return results;
};

/** Returns a deduplicated array of the tests passed in. Throws if any are unrecognized. */
const validateTestNames = (...testNames: Array<string>) => {
	const validNames = new Set(Object.keys(testActions()));
	const uniqueTests = new Set(testNames);
	const invalidTests = testNames.filter((name) => !validNames.has(name));
	if (invalidTests.length > 0) {
		throw new Error(`unrecognized test names: ${invalidTests.join(", ")}`);
	}
	return [...uniqueTests];
};
