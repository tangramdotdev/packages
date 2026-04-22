import * as std from "std" with { source: "../std" };
import { $ } from "std" with { source: "../std" };
import dash from "dash" with { source: "../dash.tg.ts" };

import { cargo, self, VERSION } from "./tangram.ts";

import cargoToml from "./tgrustc/Cargo.toml" with { type: "file" };
import cargoLock from "./tgrustc/Cargo.lock" with { type: "file" };
import src from "./tgrustc/src" with { type: "directory" };

/** Layout so `../../std` from tgrustc's Cargo.toml resolves to the std Rust workspace. */
export let source = async () => {
	return tg.directory({
		"rust/tgrustc": {
			"Cargo.toml": cargoToml,
			"Cargo.lock": cargoLock,
			src,
		},
		std: std.rustSource,
	});
};

export type Arg = cargo.Arg;

export const proxy = async (...args: std.Args<Arg>) =>
	cargo.build(
		{
			source: source(),
			manifestSubdir: "rust/tgrustc",
			proxy: false,
			useCargoVendor: true,
		},
		...args,
	);

export default proxy;

import { libclang } from "llvm" with { source: "../llvm" };
import pkgconf from "pkgconf" with { source: "../pkgconf.tg.ts" };
import openssl from "openssl" with { source: "../openssl.tg.ts" };
import xz from "xz" with { source: "../xz.tg.ts" };
import tests from "./tests" with { type: "directory" };

export const testProxyCompiles = async () => {
	const version = await $`tgrustc rustc - --version | tee ${tg.output}`
		.env(proxy())
		.env(self())
		.then(tg.File.expect);
	const versionText = await version.text;
	tg.assert(versionText.trim().includes(VERSION));
};

export const testHello = async () => {
	const helloWorld = await cargo.build({
		source: tests.get("hello-world").then(tg.Directory.expect),
		proxy: true,
		env: {
			TGRUSTC_TRACING: "tgrustc=trace",
		},
	});
	console.log("helloWorld result", helloWorld.id);

	const helloOutput = await $`hello-world | tee ${tg.output}`
		.env(helloWorld)
		.then(tg.File.expect);
	const helloText = await helloOutput.text;
	tg.assert(helloText.trim() === "hello, proxy!\n128\nHello, build!");
};

export const testPkgconfig = async () => {
	const host = std.triple.host();
	const os = std.triple.os(host);
	const dylibExt = os === "darwin" ? "dylib" : "so";

	const source = tests.get("hello-c-dylib").then(tg.Directory.expect);

	let externalLibDir = await $`
		mkdir -p ${tg.output}/lib
		mkdir -p ${tg.output}/include
		gcc -shared -fPIC ${source}/src/lib.c -o ${tg.output}/lib/libexternal.${dylibExt}
		cp ${source}/src/lib.h ${tg.output}/include/lib.h`
		.env(std.sdk())
		.then(tg.Directory.expect);

	externalLibDir = await tg.directory(externalLibDir, {
		["lib/pkgconfig/external.pc"]: tg.file`
				prefix=/Users/benlovy/.tangram/tmp/06acty0tbnz835v1rxkbgs97fc/output
				exec_prefix=\${prefix}
				libdir=\${exec_prefix}/lib
				includedir=\${prefix}/include

				Name: external
				Description: Example shared library
				Version: 1.0.0
				Libs: -L\${libdir} -lexternal
				Cflags: -I\${includedir}`,
	});
	console.log("externalLibDir", externalLibDir.id);

	const rustOutput = await cargo.build({
		source,
		pre: "set -x",
		env: std.env.arg(pkgconf(), externalLibDir, {
			TGRUSTC_TRACING: "tgrustc=trace",
		}),
		parallelJobs: 1,
		proxy: true,
		verbose: true,
	});
	console.log("result", rustOutput.id);

	const testOutput = await $`myapp | tee ${tg.output}`
		.env(rustOutput)
		.then(tg.File.expect);
	const testText = await testOutput.text;
	tg.assert(testText.trim() === "You passed the number: 42");

	return externalLibDir;
};

export const testOpenSSL = async () => {
	const helloOpenssl = await cargo.build({
		source: tests.get("hello-openssl").then(tg.Directory.expect),
		env: std.env.arg(openssl(), pkgconf(), {
			TGRUSTC_TRACING: "tgrustc=trace",
		}),
		parallelJobs: 1,
		proxy: true,
		verbose: true,
	});
	console.log("helloOpenssl result", helloOpenssl.id);

	const opensslOutput = await $`hello-openssl | tee ${tg.output}`
		.env(helloOpenssl)
		.then(tg.File.expect);
	const opensslText = await opensslOutput.text;
	tg.assert(
		opensslText.trim() === "Hello, from a crate that links against libssl!",
	);
};

export const testProcMacro = async () => {
	const result = await cargo.build({
		source: tests.get("hello-proc-macro").then(tg.Directory.expect),
		proxy: true,
		env: {
			TGRUSTC_TRACING: "tgrustc=trace",
		},
	});
	console.log("testProcMacro result", result.id);

	const output = await $`app | tee ${tg.output}`
		.env(result)
		.then(tg.File.expect);
	const text = await output.text;
	tg.assert(text.trim() === "Hello from Greeter!");
};

export const testBuildScriptCodegen = async () => {
	const result = await cargo.build({
		source: tests.get("hello-codegen").then(tg.Directory.expect),
		proxy: true,
		env: {
			TGRUSTC_TRACING: "tgrustc=trace",
		},
	});
	console.log("testBuildScriptCodegen result", result.id);

	const output = await $`hello-codegen | tee ${tg.output}`
		.env(result)
		.then(tg.File.expect);
	const text = await output.text;
	tg.assert(text.trim() === "generated at build time");
};

export const testBuildScriptEnvDep = async () => {
	const build1 = await cargo.build({
		source: tests.get("hello-env-dep").then(tg.Directory.expect),
		proxy: true,
		env: {
			MY_BUILD_VAR: "first_value",
			TGRUSTC_TRACING: "tgrustc=trace",
		},
	});
	console.log("testBuildScriptEnvDep build1 result", build1.id);

	const output1 = await $`hello-env-dep | tee ${tg.output}`
		.env(build1)
		.then(tg.File.expect);
	const text1 = await output1.text;
	tg.assert(text1.includes("first_value"));

	// Different value must NOT use cache.
	const build2 = await cargo.build({
		source: tests.get("hello-env-dep").then(tg.Directory.expect),
		proxy: true,
		env: {
			MY_BUILD_VAR: "second_value",
			TGRUSTC_TRACING: "tgrustc=trace",
		},
	});
	console.log("testBuildScriptEnvDep build2 result", build2.id);

	const output2 = await $`hello-env-dep | tee ${tg.output}`
		.env(build2)
		.then(tg.File.expect);
	const text2 = await output2.text;
	tg.assert(text2.includes("second_value"));
};

export const testBuildScriptFileDep = async () => {
	const result = await cargo.build({
		source: tests.get("hello-file-dep").then(tg.Directory.expect),
		proxy: true,
		env: {
			TGRUSTC_TRACING: "tgrustc=trace",
		},
	});
	console.log("testBuildScriptFileDep result", result.id);

	const output = await $`hello-file-dep | tee ${tg.output}`
		.env(result)
		.then(tg.File.expect);
	const text = await output.text;
	tg.assert(text.includes("hello from config file"));
};

export const testCcRs = async () => {
	const result = await cargo.build({
		source: tests.get("hello-cc-rs").then(tg.Directory.expect),
		proxy: true,
		env: {
			TGRUSTC_TRACING: "tgrustc=trace",
		},
	});
	console.log("testCcRs result", result.id);

	const output = await $`hello-cc-rs | tee ${tg.output}`
		.env(result)
		.then(tg.File.expect);
	const text = await output.text;
	tg.assert(text.trim() === "10 + 32 = 42");
};

export const testProcMacroWithDeps = async () => {
	const result = await cargo.build({
		source: tests.get("hello-proc-macro-deps").then(tg.Directory.expect),
		proxy: true,
		env: {
			TGRUSTC_TRACING: "tgrustc=trace",
		},
	});
	console.log("testProcMacroWithDeps result", result.id);

	const output = await $`app | tee ${tg.output}`
		.env(result)
		.then(tg.File.expect);
	const text = await output.text;
	tg.assert(text.trim() === "Hello from Greeter!");
};

/** Proc macros build for host; app builds for target. */
export const testProcMacroCross = async () => {
	const hostTriple = std.triple.host();
	const hostArch = std.triple.arch(hostTriple);
	const targetArch = hostArch === "x86_64" ? "aarch64" : "x86_64";
	const targetTriple = std.triple.create(hostTriple, { arch: targetArch });

	const result = await cargo.build({
		source: tests.get("hello-proc-macro").then(tg.Directory.expect),
		proxy: true,
		target: targetTriple,
		env: {
			TGRUSTC_TRACING: "tgrustc=trace",
		},
	});
	console.log("testProcMacroCross result", result.id);

	// Cannot run it since it's cross-compiled.
	const app = await result.get("bin/app").then(tg.File.expect);
	tg.assert(app !== undefined);
};

/** Bindgen requires libclang (LLVM). */
export const testBindgen = async () => {
	const result = await cargo.build({
		source: tests.get("hello-bindgen").then(tg.Directory.expect),
		proxy: true,
		env: std.env.arg(libclang(), {
			TGRUSTC_TRACING: "tgrustc=trace",
		}),
	});
	console.log("testBindgen result", result.id);

	const output = await $`hello-bindgen | tee ${tg.output}`
		.env(result)
		.then(tg.File.expect);
	const text = await output.text;
	tg.assert(text.trim() === "6 * 7 = 42");
};

/** Stats parsed from tgrustc tracing output in cargo-stderr.log. */
export type RustcStats = {
	crate_name: string;
	cached: boolean;
	elapsed_ms: number;
	process_id: string;
	command_id: string;
};

/** Parse tgrustc stats from cargo-stderr.log; expects `<eventName> crate_name=.. elapsed_ms=.. cached=.. process_id=.. command_id=..`. */
export const parseStats = async (
	result: tg.Directory,
	eventName: string = "proxy_complete",
): Promise<Array<RustcStats> | undefined> => {
	const stderrLog = await result
		.tryGet("cargo-stderr.log")
		.then((a) => (a instanceof tg.File ? a : undefined));
	if (!stderrLog) return undefined;

	const text = await stderrLog.text;
	const stats: Array<RustcStats> = [];

	for (const line of text.split("\n")) {
		if (!line.includes(eventName)) continue;

		const crateMatch = /crate_name=(\S+)/.exec(line);
		const cachedMatch = /cached=(true|false)/.exec(line);
		const elapsedMatch = /elapsed_ms=(\d+)/.exec(line);
		const processMatch = /process_id=(\S+)/.exec(line);
		const commandMatch = /command_id=(\S+)/.exec(line);

		if (crateMatch?.[1] && cachedMatch?.[1]) {
			stats.push({
				crate_name: crateMatch[1],
				cached: cachedMatch[1] === "true",
				elapsed_ms: elapsedMatch?.[1] ? parseInt(elapsedMatch[1], 10) : 0,
				process_id: processMatch?.[1] ?? "",
				command_id: commandMatch?.[1] ?? "",
			});
		}
	}

	return stats.length > 0 ? stats : undefined;
};

/** Summarize stats: count cache hits/misses and total time. */
export const summarizeStats = (stats: Array<RustcStats>) => {
	const hits = stats.filter((s) => s.cached).length;
	const misses = stats.filter((s) => !s.cached).length;
	const totalMs = stats.reduce((sum, s) => sum + s.elapsed_ms, 0);
	return { hits, misses, totalMs, crates: stats.length };
};

/** Build with proxy and stats capture enabled. */
export const buildWithStats = (...args: std.Args<cargo.Arg>) =>
	cargo.build(...args, {
		proxy: true,
		captureStderr: true,
		env: { TGRUSTC_TRACING: "tgrustc=info" },
	});

/** Look up a crate's stats by name. */
const getCrateStatus = (stats: Array<RustcStats>, name: string) =>
	stats.find((s) => s.crate_name === name);

/** Configuration for the assertCacheHit helper. */
type CacheTestConfig = {
	source: tg.Directory;
	modifyPath: string;
	expectations: Record<string, boolean>;
	buildArgs?: std.Args<cargo.Arg>;
	tag?: string;
};

/** The common cargo.build args used by cache tests. */
const cacheTestArgs: cargo.Arg = {
	proxy: true,
	captureStderr: true,
	env: { TGRUSTC_TRACING: "tgrustc=info" },
};

/** Build, modify `modifyPath`, rebuild, assert cache hit/miss per crate. */
const assertCacheHit = async (
	config: CacheTestConfig,
): Promise<{
	first: Array<RustcStats>;
	second: Array<RustcStats>;
	secondResult: tg.Directory;
}> => {
	const { source, modifyPath, expectations, buildArgs = [], tag } = config;
	const comment = `${tag ?? "cache test modification"} ${Date.now()}`;

	const firstResult = await cargo.build(
		{ source },
		...buildArgs,
		cacheTestArgs,
	);
	const firstStats = await parseStats(firstResult);

	const originalText = await source
		.get(modifyPath)
		.then(tg.File.expect)
		.then((f: tg.File) => f.text);
	const modifiedSource = tg.directory(source, {
		[modifyPath]: tg.file(`${originalText}\n// ${comment}\n`),
	});

	const secondResult = await cargo.build(
		{ source: modifiedSource },
		...buildArgs,
		cacheTestArgs,
	);
	const secondStats = await parseStats(secondResult);

	if (!secondStats) {
		throw new Error("Rebuild should have stats.");
	}
	if (!firstStats) {
		throw new Error("First build should have stats.");
	}

	for (const [crate_name, expectedCached] of Object.entries(expectations)) {
		const status = getCrateStatus(secondStats, crate_name);
		const label = expectedCached ? "cache hit" : "cache miss";
		tg.assert(
			status?.cached === expectedCached,
			`${crate_name} should be a ${label}, got cached=${status?.cached}`,
		);
	}

	return { first: firstStats, second: secondStats, secondResult };
};

/** Test that vendored dependencies cache hit when the main crate changes. */
export const testCacheHitVendoredDeps = async () => {
	const source = await tests.get("parallel-deps").then(tg.Directory.expect);

	// Warmup so vendoring, SDK, toolchain, and proxy are cached.
	await cargo.build({ source, proxy: true });
	// Cold proxy build to populate tgrustc cache.
	await buildWithStats({ source });

	const { second, secondResult } = await assertCacheHit({
		source,
		modifyPath: "src/main.rs",
		expectations: {
			parallel_deps: false,
			aho_corasick: true,
			regex_syntax: true,
			memchr: true,
		},
	});
	const summary = summarizeStats(second);
	tg.assert(summary.hits >= 3);
	tg.assert(summary.misses >= 1);

	const output = await $`parallel-deps | tee ${tg.output}`
		.env(secondResult)
		.then(tg.File.expect);
	tg.assert((await output.text).includes("Found 2 matches"));
};

/** Test that different projects with the same dependencies share cached builds. */
export const testCacheHitSharedDepsAcrossProjects = async () => {
	await buildWithStats({
		source: tests.get("parallel-deps").then(tg.Directory.expect),
	});

	// Unique source per invocation so project_two is never cached from a prior run.
	const baseSource = await tests.get("project-two").then(tg.Directory.expect);
	const mainRs = await baseSource.get("src/main.rs").then(tg.File.expect);
	const mainRsText = await mainRs.text;
	const source = tg.directory(baseSource, {
		src: { "main.rs": `${mainRsText}\n// ${Date.now()}\n` },
	});

	const result = await buildWithStats({ source });
	const stats = await parseStats(result);
	if (!stats) {
		throw new Error("Project 2 build should have stats.");
	}

	const expectations: Record<string, boolean> = {
		project_two: false,
		aho_corasick: true,
		regex_syntax: true,
		memchr: true,
	};
	for (const [name, expectedCached] of Object.entries(expectations)) {
		const status = getCrateStatus(stats, name);
		const label = expectedCached ? "cache hit" : "cache miss";
		tg.assert(
			status?.cached === expectedCached,
			`${name} should be a ${label}, got cached=${status?.cached}`,
		);
	}
	tg.assert(summarizeStats(stats).hits >= 3);

	const output = await $`project-two | tee ${tg.output}`
		.env(result)
		.then(tg.File.expect);
	tg.assert((await output.text).includes("project 2"));
};

/** Test that unchanged workspace crates cache hit when a sibling is modified. */
export const testCacheHitUnchangedWorkspaceCrates = async () => {
	const source = await tests.get("hello-workspace").then(tg.Directory.expect);
	const { second, secondResult } = await assertCacheHit({
		source,
		modifyPath: "packages/cli/src/main.rs",
		expectations: {
			cli: false,
			greeting: true,
			bytes: true,
		},
	});
	tg.assert(summarizeStats(second).hits >= 2);

	const output = await $`cli | tee ${tg.output}`
		.env(secondResult)
		.then(tg.File.expect);
	tg.assert((await output.text).trim() === "Hello from a workspace!");
};

/** Ensures CARGO_MANIFEST_DIR is set for proc-macros that read Cargo.toml. */
export const testProxyCrossterm = async () => {
	const result = await cargo.build({
		source: tests.get("hello-crossterm").then(tg.Directory.expect),
		proxy: true,
		env: {
			TGRUSTC_TRACING: "tgrustc=trace",
		},
	});
	console.log("testProxyCrossterm result", result.id);

	// crossterm emits ANSI codes, so just check it runs.
	const output = await $`hello-crossterm | tee ${tg.output}`
		.env(result)
		.then(tg.File.expect);
	const text = await output.text;
	tg.assert(text.includes("crossterm"));

	return result;
};

/** Verifies the transitive closure covers hashbrown's deps (foldhash, equivalent, allocator-api2). */
export const testVendoredTransitiveDeps = async () => {
	const result = await cargo.build({
		source: tests.get("vendored-transitive").then(tg.Directory.expect),
		proxy: true,
	});
	console.log("testVendoredTransitiveDeps result", result.id);

	const output = await $`vendored-transitive | tee ${tg.output}`
		.env(result)
		.then(tg.File.expect);
	const text = await output.text;
	tg.assert(text.includes("Success!"));

	return result;
};

/** Multi-version deps: transitive closure must use stems (crate-metadata_hash), not names. */
export const testMultiVersionCacheHit = async () => {
	const source = await tests.get("multi-version").then(tg.Directory.expect);

	const { second } = await assertCacheHit({
		source,
		modifyPath: "crate-b/src/main.rs",
		expectations: {
			crate_a: true,
			crate_b: false,
		},
	});

	const unexpectedMisses = second.filter(
		(s) => !s.cached && s.crate_name !== "crate_b",
	);
	tg.assert(
		unexpectedMisses.length === 0,
		`Expected all crates except crate_b to be cache hits, but these were misses: ${unexpectedMisses.map((s) => s.crate_name).join(", ")}.`,
	);
};

/** Regression: transitive closure must use the real crate name, not cargo's `--extern <alias>=` alias. */
export const testAliasedExtern = async () => {
	const result = await cargo.build({
		source: tests.get("aliased-extern").then(tg.Directory.expect),
		proxy: true,
		env: {
			TGRUSTC_TRACING: "tgrustc=trace",
		},
	});
	console.log("testAliasedExtern result", result.id);

	return result;
};

/** Regression: `pub use crate as alias` (async-compression's codecs re-export). */
export const testPubUseReexport = async () => {
	const result = await cargo.build({
		source: tests.get("pub-use-reexport").then(tg.Directory.expect),
		proxy: true,
		env: {
			TGRUSTC_TRACING: "tgrustc=trace",
		},
	});
	console.log("testPubUseReexport result", result.id);

	return result;
};

/** Regression: `-L native=PATH` args must not reference the outer Tangram build's tmp dir. */
export const testXzNative = async () => {
	const result = await cargo.build({
		source: tests.get("xz-native").then(tg.Directory.expect),
		proxy: true,
		env: std.env.arg(xz(), {
			TGRUSTC_TRACING: "tgrustc=trace",
		}),
	});
	console.log("testXzNative result", result.id);

	return result;
};

/** Regression: heavy parallel compilation broke extern access (xattr→rustix, async_compression→compression_codecs). */
export const testVendoredPubUse = async () => {
	const result = await cargo.build({
		source: tests.get("vendored-pub-use").then(tg.Directory.expect),
		proxy: true,
		env: {
			TGRUSTC_TRACING: "tgrustc=info",
		},
	});
	console.log("testVendoredPubUse result", result.id);

	const output = await $`vendored-pub-use | tee ${tg.output}`
		.env(result)
		.then(tg.File.expect);
	const text = await output.text;
	tg.assert(text.includes("all crates compiled successfully"));

	return result;
};

/** Regression: when .externs sidecars are missing (e.g. mixed plain cargo / tg run), fall back to including all dep files. */
export const testMissingExternsFallback = async () => {
	const result = await cargo.build({
		source: tests.get("missing-externs").then(tg.Directory.expect),
		proxy: true,
		env: {
			TGRUSTC_TRACING: "tgrustc=info",
			TGRUSTC_TEST_SKIP_EXTERNS: "1",
		},
	});
	console.log("testMissingExternsFallback result", result.id);

	const output = await $`top | tee ${tg.output}`
		.env(result)
		.then(tg.File.expect);
	const text = await output.text;
	tg.assert(
		text.trim() === "result: 43",
		`Expected "result: 43" but got "${text.trim()}".`,
	);

	return result;
};

/** Test that tangram.ts with external imports in source does not break the proxy. */
export const testExternalTsImport = async () => {
	const source = await tests.get("hello-workspace").then(tg.Directory.expect);

	const sourceWithTangram = tg.directory(source, {
		"tangram.ts": tg.file(`
// This import references a file outside the workspace
import foo from "foo" with { source: "../external-package/foo.tg.ts" };

export default foo;
`),
	});

	const result = await buildWithStats({ source: sourceWithTangram });

	const stats = await parseStats(result);
	if (stats) {
		console.log("stats", summarizeStats(stats));
	}

	const output = await $`cli | tee ${tg.output}`
		.env(result)
		.then(tg.File.expect);
	tg.assert((await output.text).trim() === "Hello from a workspace!");
	return result;
};

/** Test that a workspace crate with build.rs at root compiles correctly. */
export const testWorkspaceBuildScript = async () => {
	const source = tests.get("workspace-build-script").then(tg.Directory.expect);

	const result = await buildWithStats({ source });

	const stats = await parseStats(result);
	if (stats) {
		console.log("stats", summarizeStats(stats));
	}

	const output = await $`app | tee ${tg.output}`
		.env(result)
		.then(tg.File.expect);
	tg.assert((await output.text).includes("Built at:"));
	return result;
};

/** Test that DEP_* env vars from build scripts do not break caching. */
export const testCacheHitWithDepVars = async () => {
	const source = await tests.get("dep-var-cache").then(tg.Directory.expect);
	await assertCacheHit({
		source,
		modifyPath: "packages/app/src/main.rs",
		expectations: {
			app: false,
			consumer: true,
			lib_sys: true,
		},
	});
};

/** node_modules is a separate env artifact so main.rs changes don't affect PATH content-addressing. */
export const testCacheHitWithPreScript = async () => {
	const source = await tests.get("vendor-cache-hit").then(tg.Directory.expect);
	const nodeModulesBin = tg.directory({ ".gitkeep": tg.file("") });
	const pre = tg`export PATH="$PATH:${nodeModulesBin}"`;

	await assertCacheHit({
		source,
		modifyPath: "packages/app/src/main.rs",
		expectations: {
			app: false,
			lib: true,
			indexmap: true,
			once_cell: true,
			memchr: true,
		},
		buildArgs: [{ useCargoVendor: true, pre }],
	});
};

/** Test that -sys crate link paths do not break caching. */
export const testSysLinkCache = async () => {
	const source = await tests.get("sys-link-cache").then(tg.Directory.expect);
	await assertCacheHit({
		source,
		modifyPath: "packages/app/src/main.rs",
		expectations: {
			app: false,
			consumer: true,
			wrapper_sys: true,
			"build_script_build(wrapper_sys)": true,
		},
	});
};

export const testRunnerWorkspaceRootAccess = async () => {
	const source = tests.get("workspace-root-access").then(tg.Directory.expect);

	const result = await cargo.build({
		source,
		proxy: true,
		env: {
			TGRUSTC_TRACING: "tgrustc=trace",
		},
	});
	console.log("testRunnerWorkspaceRootAccess result", result.id);

	const output = await $`app | tee ${tg.output}`
		.env(result)
		.then(tg.File.expect);
	const text = await output.text;
	tg.assert(
		text.includes("workspace-level shared configuration"),
		`Expected output to include workspace config, got: ${text}`,
	);
};

export const testRunnerCacheHitWorkspace = async () => {
	const source = await tests
		.get("workspace-runner-cache")
		.then(tg.Directory.expect);

	const firstResult = await buildWithStats({ source });
	const firstStats = await parseStats(firstResult);

	const originalMain = await source
		.get("packages/app/src/main.rs")
		.then(tg.File.expect)
		.then((f: tg.File) => f.text);
	const modifiedSource = tg.directory(source, {
		"packages/app/src/main.rs": tg.file(
			`${originalMain}\n// workspace runner cache test\n`,
		),
	});

	const secondResult = await buildWithStats({ source: modifiedSource });
	const secondStats = await parseStats(secondResult);
	if (!firstStats || !secondStats) {
		throw new Error("Both builds should have stats.");
	}

	const libStatus = getCrateStatus(secondStats, "lib");
	tg.assert(
		libStatus?.cached === true,
		`Proxy for lib should be a cache hit, got cached=${libStatus?.cached}.`,
	);
};

export const testRunnerBuildScript = async () => {
	const source = await tests.get("hello-cc-rs").then(tg.Directory.expect);

	const firstResult = await buildWithStats({ source });
	const firstRunnerStats = await parseStats(firstResult, "runner_complete");
	console.log(
		"runner first build stats",
		firstRunnerStats?.map((s) => `${s.crate_name}: cached=${s.cached}`),
	);

	const firstOutput = await $`hello-cc-rs | tee ${tg.output}`
		.env(firstResult)
		.then(tg.File.expect);
	tg.assert((await firstOutput.text).trim() === "10 + 32 = 42");

	// Modify only main.rs (not the build script or C source).
	const originalMain = await source
		.get("src/main.rs")
		.then(tg.File.expect)
		.then((f: tg.File) => f.text);
	const modifiedSource = tg.directory(source, {
		"src/main.rs": tg.file(`${originalMain}\n// runner cache test\n`),
	});

	const secondResult = await buildWithStats({ source: modifiedSource });
	const secondRunnerStats = await parseStats(secondResult, "runner_complete");
	console.log(
		"runner second build stats",
		secondRunnerStats?.map((s) => `${s.crate_name}: cached=${s.cached}`),
	);

	// Runner should cache-hit: build script + inputs (C source, build.rs) unchanged.
	if (secondRunnerStats) {
		for (const stat of secondRunnerStats) {
			tg.assert(
				stat.cached,
				`Build script runner for ${stat.crate_name} should be a cache hit, but was a miss.`,
			);
		}
	}

	const secondOutput = await $`hello-cc-rs | tee ${tg.output}`
		.env(secondResult)
		.then(tg.File.expect);
	tg.assert((await secondOutput.text).trim() === "10 + 32 = 42");
};

/** Regression: NODE_PATH must pass through to build scripts (tangram_js/tangram_compiler need it). */
export const testRunnerEnvPassthrough = async () => {
	// Unique source per invocation — a cached result would be a false negative.
	const baseSource = await tests
		.get("runner-env-passthrough")
		.then(tg.Directory.expect);
	const mainRs = await baseSource.get("src/main.rs").then(tg.File.expect);
	const mainRsText = await mainRs.text;
	const source = tg.directory(baseSource, {
		src: { "main.rs": `${mainRsText}\n// ${Date.now()}\n` },
	});

	const result = await cargo.build({
		source,
		proxy: true,
		env: {
			NODE_PATH: "/some/node/modules",
			TGRUSTC_TRACING: "tgrustc=trace",
		},
	});
	console.log("testRunnerEnvPassthrough result", result.id);

	const output = await $`runner-env-passthrough | tee ${tg.output}`
		.env(result)
		.then(tg.File.expect);
	const text = await output.text;
	tg.assert(
		text.includes("NODE_PATH was:"),
		"Build script should have received NODE_PATH.",
	);
};

/** Tools in NODE_PATH/.bin must resolve via PATH. */
export const testRunnerPathTools = async () => {
	// Fake node_modules with a .bin symlink, mimicking npm/bun.
	const toolFile = tg.file("tool output from my-tool\n");
	const nodeModules = tg.directory({
		"my-tool-pkg": {
			"tool.sh": toolFile,
		},
		".bin": {
			"my-tool": tg.symlink("../my-tool-pkg/tool.sh"),
		},
	});

	// Unique source per invocation — a cached result would be a false negative.
	const baseSource = await tests
		.get("runner-path-tools")
		.then(tg.Directory.expect);
	const mainRs = await baseSource.get("src/main.rs").then(tg.File.expect);
	const mainRsText = await mainRs.text;
	const source = tg.directory(baseSource, {
		node_modules: nodeModules,
		src: { "main.rs": `${mainRsText}\n// ${Date.now()}\n` },
	});

	const result = await cargo.build({
		source,
		proxy: true,
		pre: `export NODE_PATH="$TGRUSTC_SOURCE_DIR/node_modules" && export PATH="$PATH:$NODE_PATH/.bin"`,
		env: {
			TGRUSTC_TRACING: "tgrustc=trace",
		},
	});
	console.log("testRunnerPathTools result", result.id);

	const output = await $`runner-path-tools | tee ${tg.output}`
		.env(result)
		.then(tg.File.expect);
	const text = await output.text;
	tg.assert(
		text.includes("tool output from my-tool"),
		"Build script should have run my-tool from NODE_PATH/.bin.",
	);
};

/** Regression: cfg probes via RUSTC_WRAPPER must not inherit TGRUSTC_* internals (rustix can_compile). */
export const testRunnerCfgProbe = async () => {
	// Unique source per invocation — a cached result would be a false negative.
	const baseSource = await tests
		.get("runner-cfg-probe")
		.then(tg.Directory.expect);
	const mainRs = await baseSource.get("src/main.rs").then(tg.File.expect);
	const mainRsText = await mainRs.text;
	const source = tg.directory(baseSource, {
		src: { "main.rs": `${mainRsText}\n// ${Date.now()}\n` },
	});

	const result = await cargo.build({
		source,
		proxy: true,
		env: {
			TGRUSTC_TRACING: "tgrustc=trace",
		},
	});
	console.log("testRunnerCfgProbe result", result.id);

	const output = await $`runner-cfg-probe | tee ${tg.output}`
		.env(result)
		.then(tg.File.expect);
	const text = await output.text;
	tg.assert(
		text.includes("probe passed"),
		"Build script cfg probe via RUSTC_WRAPPER should succeed in runner mode.",
	);
};

/** Regression: runner sandbox lacks /usr/bin/env; wrap shebang scripts with std.wrap to an explicit interpreter. */
export const testRunnerPathExec = async () => {
	const host = await std.triple.host();
	const dashBin = await dash({ host })
		.then((d) => d.get("bin/dash"))
		.then(tg.File.expect);
	// Wrap the shebang script so it becomes native ELF (no /usr/bin/env needed).
	const script = tg.file({
		contents: '#!/usr/bin/env sh\necho "hello from exec tool"\n',
		executable: true,
	});
	const tool = await std.wrap(script, { interpreter: dashBin, host });
	const toolDir = tg.directory({ bin: { "my-exec-tool": tool } });

	// Unique source per invocation — a cached result would be a false negative.
	const baseSource = await tests
		.get("runner-path-exec")
		.then(tg.Directory.expect);
	const mainRs = await baseSource.get("src/main.rs").then(tg.File.expect);
	const mainRsText = await mainRs.text;
	const source = tg.directory(baseSource, {
		src: { "main.rs": `${mainRsText}\n// ${Date.now()}\n` },
	});

	const result = await cargo.build({
		source,
		proxy: true,
		env: std.env.arg(toolDir, {
			TGRUSTC_TRACING: "tgrustc=trace",
		}),
	});
	console.log("testRunnerPathExec result", result.id);

	const output = await $`runner-path-exec | tee ${tg.output}`
		.env(result)
		.then(tg.File.expect);
	const text = await output.text;
	tg.assert(
		text.includes("hello from exec tool"),
		"Build script should have executed the tool from PATH.",
	);
};

/** Run mode dispatch: workspace members → passthrough; external deps → proxy. */
export const testRunMode = async () => {
	const source = await tests.get("hello-workspace").then(tg.Directory.expect);

	const result = await cargo.build({
		source,
		proxy: true,
		captureStderr: true,
		env: {
			TGRUSTC_TRACING: "tgrustc=info",
			TGRUSTC_RUN_MODE: "1",
			TGRUSTC_PASSTHROUGH_PROJECT_DIR: tg`${source}`,
		},
	});

	const stderrLog = await result
		.tryGet("cargo-stderr.log")
		.then((a) => (a instanceof tg.File ? a : undefined));
	tg.assert(stderrLog !== undefined, "Should have cargo-stderr.log.");
	const stderrText = await stderrLog.text;

	const proxyStats = await parseStats(result, "proxy_complete");
	tg.assert(
		proxyStats !== undefined &&
			proxyStats.some((s) => s.crate_name === "bytes"),
		"bytes should go through proxy_complete.",
	);

	tg.assert(
		stderrText.includes("passthrough mode"),
		"Workspace members should use passthrough.",
	);

	const output = await $`${result}/bin/cli | tee ${tg.output}`.then(
		tg.File.expect,
	);
	tg.assert((await output.text).trim() === "Hello from a workspace!");

	return result;
};

/** Run mode: external dep (bytes) stays cached when a workspace member changes. */
export const testRunModeCacheHit = async () => {
	const source = await tests.get("hello-workspace").then(tg.Directory.expect);

	const firstResult = await cargo.build({
		source,
		proxy: true,
		captureStderr: true,
		env: {
			TGRUSTC_TRACING: "tgrustc=info",
			TGRUSTC_RUN_MODE: "1",
			TGRUSTC_PASSTHROUGH_PROJECT_DIR: tg`${source}`,
		},
	});
	const firstStats = await parseStats(firstResult);
	tg.assert(firstStats !== undefined, "First build should have stats.");

	const originalText = await source
		.get("packages/cli/src/main.rs")
		.then(tg.File.expect)
		.then((f: tg.File) => f.text);
	const modifiedSource = tg.directory(source, {
		"packages/cli/src/main.rs": tg.file(
			`${originalText}\n// run mode cache test\n`,
		),
	});

	// PASSTHROUGH_PROJECT_DIR tracks the modified source for member detection.
	const secondResult = await cargo.build({
		source: modifiedSource,
		proxy: true,
		captureStderr: true,
		env: {
			TGRUSTC_TRACING: "tgrustc=info",
			TGRUSTC_RUN_MODE: "1",
			TGRUSTC_PASSTHROUGH_PROJECT_DIR: tg`${modifiedSource}`,
		},
	});
	const secondStats = await parseStats(secondResult);
	tg.assert(secondStats !== undefined, "Second build should have stats.");

	const bytesStatus = secondStats.find((s) => s.crate_name === "bytes");
	tg.assert(
		bytesStatus?.cached === true,
		`bytes should be a cache hit, got cached=${bytesStatus?.cached}.`,
	);

	const output = await $`${secondResult}/bin/cli | tee ${tg.output}`.then(
		tg.File.expect,
	);
	tg.assert((await output.text).trim() === "Hello from a workspace!");
};

/** Passthrough dispatch: workspace crates → direct rustc, deps → proxy. */
export const testPassthrough = async () => {
	const source = await tests.get("hello-workspace").then(tg.Directory.expect);

	const result = await cargo.build({
		source,
		proxy: true,
		captureStderr: true,
		env: {
			TGRUSTC_TRACING: "tgrustc=info",
			TGRUSTC_PASSTHROUGH_PROJECT_DIR: tg`${source}`,
		},
	});

	const stderrLog = await result
		.tryGet("cargo-stderr.log")
		.then((a) => (a instanceof tg.File ? a : undefined));
	tg.assert(stderrLog !== undefined, "Should have cargo-stderr.log");
	const stderrText = await stderrLog.text;

	tg.assert(
		stderrText.includes("passthrough mode"),
		"Workspace members should trigger passthrough mode",
	);

	tg.assert(
		stderrText.includes("spawned process"),
		"Dependencies should go through the normal proxy path",
	);

	const output = await $`${result}/bin/cli | tee ${tg.output}`.then(
		tg.File.expect,
	);
	tg.assert((await output.text).trim() === "Hello from a workspace!");

	return result;
};

export const test = async () => {
	await testProxyCompiles();
	await Promise.all([
		testHello(),
		testPkgconfig(),
		testOpenSSL(),
		testProcMacro(),
		testProxyCrossterm(),
		testBuildScriptCodegen(),
		testBuildScriptEnvDep(),
		testBuildScriptFileDep(),
		testCcRs(),
		testProcMacroWithDeps(),
		testCacheHitVendoredDeps(),
		testCacheHitSharedDepsAcrossProjects(),
		testCacheHitUnchangedWorkspaceCrates(),
		testExternalTsImport(),
		testWorkspaceBuildScript(),
		testMultiVersionCacheHit(),
		testAliasedExtern(),
		testPubUseReexport(),
		testXzNative(),
		testVendoredPubUse(),
		testMissingExternsFallback(),
		testCacheHitWithDepVars(),
		testCacheHitWithPreScript(),
		testSysLinkCache(),
		testRunnerWorkspaceRootAccess(),
		testRunnerCacheHitWorkspace(),
		testRunnerBuildScript(),
		testRunnerEnvPassthrough(),
		testRunnerPathTools(),
		testRunnerCfgProbe(),
		testRunnerPathExec(),
		testPassthrough(),
		testRunMode(),
		testRunModeCacheHit(),
	]);
};
