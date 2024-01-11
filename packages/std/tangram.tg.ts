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
export { triple, Triple } from "./triple.tg.ts";
export * as utils from "./utils.tg.ts";
export { default as wrap } from "./wrap.tg.ts";

export let metadata = {
	name: "std",
	version: "0.0.0"
};

export let flatten = <T,>(value: tg.MaybeNestedArray<T>): Array<T> => {
	// @ts-ignore
	return value instanceof Array ? value.flat(Infinity) : [value];
};

export let test = tg.target(() => testDefaultSdk());

import { Triple } from "./triple.tg.ts";
export let testHostSystem = tg.target(async () => {
	return Triple.host();
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
	return await proxy.test();
});

import * as bootstrap from "./bootstrap.tg.ts";
export let testBootstrap = tg.target(async () => {
	return await bootstrap.test();
});
export let testPlainBootstrapSdk = tg.target(async () => {
	let bootstrapSdk = await bootstrap.sdk.env();
	console.log("env", bootstrapSdk);
	return bootstrapSdk;
});

import * as wrap from "./wrap.tg.ts";
export let testWrap = tg.target(async () => {
	let shell = await bootstrap.shell();
	let exe = tg.File.expect(await shell.get("bin/dash"));
	return await wrap.wrap(exe, { env: { HELLO: tg.Mutation.set(`hi`) } });
});
export let testMuslWrapper = tg.target(async () => {
	return await wrap.testSingleArgObjectNoMutations();
});

import * as bootstrapMake from "./bootstrap/make.tg.ts";
export let testBootstrapMake = tg.target(async () => {
	return await bootstrapMake.test();
});

export let testBootstrapMusl = tg.target(async () => {
	return await bootstrap.musl.build();
});

// std.utils tests

import * as utils from "./utils.tg.ts";
export let testUtilsBash = tg.target(async () => {
	return await utils.bash.test();
});
export let testUtilsCoreutils = tg.target(async () => {
	return await utils.coreutils.test();
});
export let testUtilsLibiconv = tg.target(async () => {
	return await utils.libiconv.test();
});
export let testUtilsAttr = tg.target(async () => {
	return await utils.attr.test();
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
export let testUtilsSed = tg.target(async () => {
	return await utils.sed.test();
});
export let testUtilsTar = tg.target(async () => {
	return await utils.tar.test();
});
export let testUtils = tg.target(async () => {
	return await utils.test();
});

// sdk dependencies tests

import * as dependencies from "./sdk/dependencies.tg.ts";
export let testDeps = tg.target(async () => {
	return await dependencies.test();
});
export let testDepsAutoconf = tg.target(async () => {
	return await dependencies.autoconf.test();
});
export let testDepsAutomake = tg.target(async () => {
	return await dependencies.automake.test();
});
export let testDepsBc = tg.target(async () => {
	return await dependencies.bc.test();
});
export let testDepsBison = tg.target(async () => {
	return await dependencies.bison.test();
});
export let testDepsBzip2 = tg.target(async () => {
	return await dependencies.bzip2.test();
});
export let testDepsFile = tg.target(async () => {
	return await dependencies.file.test();
});
export let testDepsFlex = tg.target(async () => {
	return await dependencies.flex.test();
});
export let testDepsGperf = tg.target(async () => {
	return await dependencies.gperf.test();
});
export let testDepsHelp2man = tg.target(async () => {
	return await dependencies.help2man.test();
});
export let testDepsLibffi = tg.target(async () => {
	return await dependencies.libffi.test();
});
export let testDepsm4 = tg.target(async () => {
	return await dependencies.m4.test();
});
export let testDepsMake = tg.target(async () => {
	return await dependencies.make.test();
});
export let testDepsPatch = tg.target(async () => {
	return await dependencies.patch.test();
});
export let testDepsPerl = tg.target(async () => {
	return await dependencies.perl.test();
});
export let testDepsPkgconfig = tg.target(async () => {
	return await dependencies.pkgconfig.test();
});
export let testDepsPython = tg.target(async () => {
	return await dependencies.python.test();
});
export let testDepsTexinfo = tg.target(async () => {
	return await dependencies.texinfo.test();
});
export let testDepsXz = tg.target(async () => {
	return await dependencies.xz.test();
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
	return await binutils.source(await Triple.host());
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

// SDK tests.

import { toolchainTriple as bootstrapToolchainTriple } from "./bootstrap.tg.ts";
import { sdk } from "./sdk.tg.ts";
export let testBootstrapSdk = tg.target(async () => {
	let env = await sdk({ bootstrapMode: true });
	let host = await Triple.host();
	let detectedHost = bootstrapToolchainTriple(host);
	await sdk.assertValid(env, { host: detectedHost, bootstrapMode: true });
	return env;
});

export let testDefaultSdk = tg.target(async () => {
	let env = await sdk();
	let detectedHost = await Triple.host();
	await sdk.assertValid(env, { host: detectedHost });
	return env;
});

// Image tests.

import * as image from "./image.tg.ts";
export let testOciWrappedEntrypoint = tg.target(async () => {
	return await image.testWrappedEntrypoint();
});
export let testOciBasicRootfs = tg.target(async () => {
	return await image.testBasicRootfs();
});
