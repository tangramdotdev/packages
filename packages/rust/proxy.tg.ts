import * as std from "std" with { local: "../std" };
import { $ } from "std" with { local: "../std" };
import dash from "dash" with { local: "../dash.tg.ts" };

import { cargo, self, VERSION } from "./tangram.ts";

import cargoToml from "./tgrustc/Cargo.toml" with { type: "file" };
import cargoLock from "./tgrustc/Cargo.lock" with { type: "file" };
import src from "./tgrustc/src" with { type: "directory" };

// Create a source directory structure where `../../std` from tgrustc's Cargo.toml resolves to the std Rust workspace.
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
			features: ["tracing"],
			proxy: false,
			useCargoVendor: true,
		},
		...args,
	);

export default proxy;

import { libclang } from "llvm" with { local: "../llvm" };
import pkgconf from "pkgconf" with { local: "../pkgconf.tg.ts" };
import openssl from "openssl" with { local: "../openssl.tg.ts" };
import xz from "xz" with { local: "../xz.tg.ts" };
import tests from "./tests" with { type: "directory" };

export const testProxyCompiles = async () => {
	// Make sure the proxy compiles and runs.
	const version = await $`tgrustc rustc - --version | tee ${tg.output}`
		.env(proxy())
		.env(self())
		.then(tg.File.expect);
	const versionText = await version.text;
	tg.assert(versionText.trim().includes(VERSION));
};

export const testHello = async () => {
	// Build the basic proxy test.
	const helloWorld = await cargo.build({
		source: tests.get("hello-world").then(tg.Directory.expect),
		proxy: true,
		env: {
			TGRUSTC_TRACING: "tgrustc=trace",
		},
	});
	console.log("helloWorld result", helloWorld.id);

	// Assert it produces the correct output.
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

	// compile the dylib
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

	// compile the rust.
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

	// Assert it produces the correct output.
	const testOutput = await $`myapp | tee ${tg.output}`
		.env(rustOutput)
		.then(tg.File.expect);
	const testText = await testOutput.text;
	tg.assert(testText.trim() === "You passed the number: 42");

	return externalLibDir;
};

export const testOpenSSL = async () => {
	// Build the openssl proxy test.
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

	// Assert it produces the correct output.
	const opensslOutput = await $`hello-openssl | tee ${tg.output}`
		.env(helloOpenssl)
		.then(tg.File.expect);
	const opensslText = await opensslOutput.text;
	tg.assert(
		opensslText.trim() === "Hello, from a crate that links against libssl!",
	);
};

export const testProcMacro = async () => {
	// Build a workspace with a proc-macro crate and an app that uses it.
	const result = await cargo.build({
		source: tests.get("hello-proc-macro").then(tg.Directory.expect),
		proxy: true,
		env: {
			TGRUSTC_TRACING: "tgrustc=trace",
		},
	});
	console.log("testProcMacro result", result.id);

	// Assert it produces the correct output.
	const output = await $`app | tee ${tg.output}`
		.env(result)
		.then(tg.File.expect);
	const text = await output.text;
	tg.assert(text.trim() === "Hello from Greeter!");
};

export const testBuildScriptCodegen = async () => {
	// Build a project with a build script that generates Rust code.
	const result = await cargo.build({
		source: tests.get("hello-codegen").then(tg.Directory.expect),
		proxy: true,
		env: {
			TGRUSTC_TRACING: "tgrustc=trace",
		},
	});
	console.log("testBuildScriptCodegen result", result.id);

	// Assert it produces the correct output.
	const output = await $`hello-codegen | tee ${tg.output}`
		.env(result)
		.then(tg.File.expect);
	const text = await output.text;
	tg.assert(text.trim() === "generated at build time");
};

export const testBuildScriptEnvDep = async () => {
	// Build with MY_BUILD_VAR=first
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

	// Build with MY_BUILD_VAR=second - should NOT use cache
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
	// Build a project with a build script that watches a file.
	const result = await cargo.build({
		source: tests.get("hello-file-dep").then(tg.Directory.expect),
		proxy: true,
		env: {
			TGRUSTC_TRACING: "tgrustc=trace",
		},
	});
	console.log("testBuildScriptFileDep result", result.id);

	// Assert it produces the correct output.
	const output = await $`hello-file-dep | tee ${tg.output}`
		.env(result)
		.then(tg.File.expect);
	const text = await output.text;
	tg.assert(text.includes("hello from config file"));
};

export const testCcRs = async () => {
	// Build a project with a build script that uses cc-rs to compile C code.
	const result = await cargo.build({
		source: tests.get("hello-cc-rs").then(tg.Directory.expect),
		proxy: true,
		env: {
			TGRUSTC_TRACING: "tgrustc=trace",
		},
	});
	console.log("testCcRs result", result.id);

	// Assert it produces the correct output.
	const output = await $`hello-cc-rs | tee ${tg.output}`
		.env(result)
		.then(tg.File.expect);
	const text = await output.text;
	tg.assert(text.trim() === "10 + 32 = 42");
};

export const testProcMacroWithDeps = async () => {
	// Build a workspace with a proc-macro crate that uses syn/quote.
	const result = await cargo.build({
		source: tests.get("hello-proc-macro-deps").then(tg.Directory.expect),
		proxy: true,
		env: {
			TGRUSTC_TRACING: "tgrustc=trace",
		},
	});
	console.log("testProcMacroWithDeps result", result.id);

	// Assert it produces the correct output.
	const output = await $`app | tee ${tg.output}`
		.env(result)
		.then(tg.File.expect);
	const text = await output.text;
	tg.assert(text.trim() === "Hello from Greeter!");
};

export const testProcMacroCross = async () => {
	// Cross-compile a proc-macro workspace.
	// Proc macros must compile for the host, while the app compiles for the target.
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

	// Verify the binary exists (we cannot run it since it is cross-compiled).
	const app = await result.get("bin/app").then(tg.File.expect);
	tg.assert(app !== undefined);
};

export const testBindgen = async () => {
	// Build a project with a build script that uses bindgen.
	// Bindgen requires libclang, so we need to provide LLVM.
	const result = await cargo.build({
		source: tests.get("hello-bindgen").then(tg.Directory.expect),
		proxy: true,
		env: std.env.arg(libclang(), {
			TGRUSTC_TRACING: "tgrustc=trace",
		}),
	});
	console.log("testBindgen result", result.id);

	// Assert it produces the correct output.
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

/** Parse tgrustc stats from cargo-stderr.log in a build result.
 *
 * Looks for tracing events matching `eventName` in the format:
 * `<eventName> crate_name=<name> elapsed_ms=<ms> cached=<true|false> process_id=<id> command_id=<id>`
 */
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

/** Build, modify a file, rebuild, and assert cache hit/miss expectations.
 *
 * 1. Builds once to populate cache.
 * 2. Reads modifyPath from source, appends a unique comment.
 * 3. Rebuilds and parses stats from both builds.
 * 4. Asserts each crate in expectations matches its expected hit/miss.
 * 5. Returns both stat arrays and the second result directory.
 */
const assertCacheHit = async (
	config: CacheTestConfig,
): Promise<{
	first: Array<RustcStats>;
	second: Array<RustcStats>;
	secondResult: tg.Directory;
}> => {
	const { source, modifyPath, expectations, buildArgs = [], tag } = config;
	const comment = `${tag ?? "cache test modification"} ${Date.now()}`;

	// First build to populate cache.
	const firstResult = await cargo.build(
		{ source },
		...buildArgs,
		cacheTestArgs,
	);
	const firstStats = await parseStats(firstResult);

	// Modify the specified file.
	const originalText = await source
		.get(modifyPath)
		.then(tg.File.expect)
		.then((f: tg.File) => f.text);
	const modifiedSource = tg.directory(source, {
		[modifyPath]: tg.file(`${originalText}\n// ${comment}\n`),
	});

	// Rebuild with modified source.
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

	// Assert expectations.
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

	// Warmup build to ensure vendoring, SDK, toolchain, and proxy are cached.
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

	// Verify the binary works.
	const output = await $`parallel-deps | tee ${tg.output}`
		.env(secondResult)
		.then(tg.File.expect);
	tg.assert((await output.text).includes("Found 2 matches"));
};

/** Test that different projects with the same dependencies share cached builds. */
export const testCacheHitSharedDepsAcrossProjects = async () => {
	// Build project 1 to populate cache for shared deps.
	await buildWithStats({
		source: tests.get("parallel-deps").then(tg.Directory.expect),
	});

	// Make project 2 source unique per invocation so the project_two crate is
	// never cached from a previous test run.
	const baseSource = await tests.get("project-two").then(tg.Directory.expect);
	const mainRs = await baseSource.get("src/main.rs").then(tg.File.expect);
	const mainRsText = await mainRs.text;
	const source = tg.directory(baseSource, {
		src: { "main.rs": `${mainRsText}\n// ${Date.now()}\n` },
	});

	// Build project 2 - deps should be cached from project 1.
	const result = await buildWithStats({ source });
	const stats = await parseStats(result);
	if (!stats) {
		throw new Error("Project 2 build should have stats.");
	}

	// Shared dependencies should hit, project-two crate should miss.
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

	// Verify project 2 produces correct output.
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

	// Verify rebuilt binary works.
	const output = await $`cli | tee ${tg.output}`
		.env(secondResult)
		.then(tg.File.expect);
	tg.assert((await output.text).trim() === "Hello from a workspace!");
};

/** Test proxy with crossterm crate which uses proc-macros that read Cargo.toml.
 *
 * Ensures CARGO_MANIFEST_DIR is set correctly for proc-macros.
 */
export const testProxyCrossterm = async () => {
	const result = await cargo.build({
		source: tests.get("hello-crossterm").then(tg.Directory.expect),
		proxy: true,
		env: {
			TGRUSTC_TRACING: "tgrustc=trace",
		},
	});
	console.log("testProxyCrossterm result", result.id);

	// Crossterm outputs ANSI codes, so we just check it runs.
	const output = await $`hello-crossterm | tee ${tg.output}`
		.env(result)
		.then(tg.File.expect);
	const text = await output.text;
	tg.assert(text.includes("crossterm"));

	return result;
};

export const testVendoredTransitiveDeps = async () => {
	// Test transitive dependencies with vendored crates.
	// hashbrown depends on foldhash, equivalent, allocator-api2.
	// This tests that the transitive closure includes all deps.
	const result = await cargo.build({
		source: tests.get("vendored-transitive").then(tg.Directory.expect),
		proxy: true,
	});
	console.log("testVendoredTransitiveDeps result", result.id);

	// Run the binary to verify it works.
	const output = await $`vendored-transitive | tee ${tg.output}`
		.env(result)
		.then(tg.File.expect);
	const text = await output.text;
	tg.assert(text.includes("Success!"));

	return result;
};

/** Test cache behavior with multi-version dependencies.
 *
 * When a workspace has multiple versions of the same crate (e.g., hashbrown 0.14
 * and 0.16), the transitive closure must use stems (crate_name-metadata_hash) to
 * identify specific versions.
 */
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

	// All vendored deps should also cache hit.
	const unexpectedMisses = second.filter(
		(s) => !s.cached && s.crate_name !== "crate_b",
	);
	tg.assert(
		unexpectedMisses.length === 0,
		`Expected all crates except crate_b to be cache hits, but these were misses: ${unexpectedMisses.map((s) => s.crate_name).join(", ")}.`,
	);
};

export const testAliasedExtern = async () => {
	// Test with crate aliases like signal-hook-mio which uses mio_1_0 for mio.
	// This reproduces the bug where the transitive closure used the alias name
	// instead of the actual crate name from the file path.
	//
	// The key test is that signal_hook_mio compiles successfully. It depends on
	// mio but cargo passes it as --extern mio_1_0=/path/to/libmio-*.rmeta.
	// Without the fix, the transitive closure would look for "mio_1_0" in the
	// .externs files but find nothing (they use the real name "mio"), causing
	// mio's dependencies to be missing from the merged deps directory.
	const result = await cargo.build({
		source: tests.get("aliased-extern").then(tg.Directory.expect),
		proxy: true,
		env: {
			TGRUSTC_TRACING: "tgrustc=trace",
		},
	});
	console.log("testAliasedExtern result", result.id);

	// Build succeeding means signal_hook_mio compiled (which tests the alias fix).
	return result;
};

export const testPubUseReexport = async () => {
	// Test the `pub use crate as alias` pattern, mirroring async-compression's
	// `pub use compression_codecs as codecs;` which fails when building tangram.
	// This ensures the proxy correctly handles crate re-exports.
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

export const testXzNative = async () => {
	// Test with a crate that depends on liblzma-sys with xz provided in the
	// environment. This reproduces the bug where -L native=PATH args reference
	// the xz Tangram build's tmp directory, which does not exist in the inner
	// process sandbox.
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

/** Test that vendored crates with many parallel dependencies compile correctly.
 *
 * This reproduces the bug seen when building tangram with `proxy: true`:
 * - xattr fails: "can't find crate for `rustix`"
 * - async_compression fails: "can't find crate for `compression_codecs`"
 *
 * The issue only manifests with heavy parallel compilation (many vendored crates
 * building simultaneously). The extern artifact paths are constructed correctly,
 * but the inner rustc process cannot access them.
 *
 * The test includes:
 * - async-compression (uses `pub use compression_codecs as codecs`)
 * - xattr (depends on rustix)
 * - regex, serde, serde_json (add parallelism pressure)
 */
export const testVendoredPubUse = async () => {
	const result = await cargo.build({
		source: tests.get("vendored-pub-use").then(tg.Directory.expect),
		proxy: true,
		env: {
			TGRUSTC_TRACING: "tgrustc=info",
		},
	});
	console.log("testVendoredPubUse result", result.id);

	// Verify the build succeeded by running the binary.
	const output = await $`vendored-pub-use | tee ${tg.output}`
		.env(result)
		.then(tg.File.expect);
	const text = await output.text;
	tg.assert(text.includes("all crates compiled successfully"));

	return result;
};

/** Test that tangram.ts with external imports in source does not break the proxy. */
export const testExternalTsImport = async () => {
	const source = await tests.get("hello-workspace").then(tg.Directory.expect);

	// Add a tangram.ts file that imports from an external path (simulating the tangram repo structure).
	const sourceWithTangram = tg.directory(source, {
		"tangram.ts": tg.file(`
// This import references a file outside the workspace
import foo from "foo" with { local: "../external-package/foo.tg.ts" };

export default foo;
`),
	});

	const result = await buildWithStats({ source: sourceWithTangram });

	const stats = await parseStats(result);
	if (stats) {
		console.log("stats", summarizeStats(stats));
	}

	// Verify the build succeeded.
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

	// Verify the build succeeded.
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

/** Test vendored crate caching with pre script that modifies PATH.
 *
 * The node_modules directory is provided as a separate artifact via env so that
 * changing app/src/main.rs does not affect the PATH content-addressing.
 */
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

/** Test that workspace member build scripts can access files at the workspace root. */
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

	// Verify the build succeeded and the config from the workspace root was included.
	const output = await $`app | tee ${tg.output}`
		.env(result)
		.then(tg.File.expect);
	const text = await output.text;
	tg.assert(
		text.includes("workspace-level shared configuration"),
		`Expected output to include workspace config, got: ${text}`,
	);
};

/** Test that the build script runner caches workspace member build scripts
 * when only an unrelated crate is modified.
 */
export const testRunnerCacheHitWorkspace = async () => {
	const source = await tests
		.get("workspace-runner-cache")
		.then(tg.Directory.expect);

	// First build to populate both rustc and runner caches.
	const firstResult = await buildWithStats({ source });
	const firstStats = await parseStats(firstResult);

	// Modify only app/src/main.rs (not the lib crate or its build script).
	const originalMain = await source
		.get("packages/app/src/main.rs")
		.then(tg.File.expect)
		.then((f: tg.File) => f.text);
	const modifiedSource = tg.directory(source, {
		"packages/app/src/main.rs": tg.file(
			`${originalMain}\n// workspace runner cache test\n`,
		),
	});

	// Rebuild with modified source.
	const secondResult = await buildWithStats({ source: modifiedSource });
	const secondStats = await parseStats(secondResult);
	if (!firstStats || !secondStats) {
		throw new Error("Both builds should have stats.");
	}

	// The proxy for lib should be a cache hit since only app was modified.
	const libStatus = getCrateStatus(secondStats, "lib");
	tg.assert(
		libStatus?.cached === true,
		`Proxy for lib should be a cache hit, got cached=${libStatus?.cached}.`,
	);
};

/** Test that the build script runner caches build script execution.
 *
 * Uses the hello-cc-rs test project which has a build script that compiles C
 * code using cc-rs. Builds twice with a modified main.rs to verify that:
 * 1. The build script runner invocation is cached on the second build.
 * 2. The rustc proxy invocations for unchanged crates are also cached.
 * 3. The binary produces correct output after both builds.
 */
export const testRunnerBuildScript = async () => {
	const source = await tests.get("hello-cc-rs").then(tg.Directory.expect);

	// First build to populate both rustc and runner caches.
	const firstResult = await buildWithStats({ source });
	const firstRunnerStats = await parseStats(firstResult, "runner_complete");
	console.log(
		"runner first build stats",
		firstRunnerStats?.map((s) => `${s.crate_name}: cached=${s.cached}`),
	);

	// Verify the first build produces correct output.
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

	// Rebuild with modified source.
	const secondResult = await buildWithStats({ source: modifiedSource });
	const secondRunnerStats = await parseStats(secondResult, "runner_complete");
	console.log(
		"runner second build stats",
		secondRunnerStats?.map((s) => `${s.crate_name}: cached=${s.cached}`),
	);

	// The build script runner should be a cache hit since the build script
	// and its inputs (C source, build.rs) did not change.
	if (secondRunnerStats) {
		for (const stat of secondRunnerStats) {
			tg.assert(
				stat.cached,
				`Build script runner for ${stat.crate_name} should be a cache hit, but was a miss.`,
			);
		}
	}

	// Verify the second build also produces correct output.
	const secondOutput = await $`hello-cc-rs | tee ${tg.output}`
		.env(secondResult)
		.then(tg.File.expect);
	tg.assert((await secondOutput.text).trim() === "10 + 32 = 42");
};

/** Test that the runner passes through environment variables to build scripts.
 *
 * Reproduces the tangram.ts testProxy failure where NODE_PATH is blacklisted
 * from the runner environment. The tangram_js and tangram_compiler build scripts
 * check for NODE_PATH; when it is missing, they try to create a lock file outside
 * the workspace, which fails in the runner sandbox with PermissionDenied.
 */
export const testRunnerEnvPassthrough = async () => {
	// Make the source unique per invocation so the build is never cached. This
	// test validates runtime sandbox behavior, so a cached result would be a
	// false negative.
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

	// Assert the binary received NODE_PATH from the build script.
	const output = await $`runner-env-passthrough | tee ${tg.output}`
		.env(result)
		.then(tg.File.expect);
	const text = await output.text;
	tg.assert(
		text.includes("NODE_PATH was:"),
		"Build script should have received NODE_PATH.",
	);
};

/** Test that the runner makes tools in NODE_PATH/.bin available via PATH. */
export const testRunnerPathTools = async () => {
	// Create a fake node_modules directory with a .bin symlink structure
	// mimicking how npm/bun installs tools.
	const toolFile = tg.file("tool output from my-tool\n");
	const nodeModules = tg.directory({
		"my-tool-pkg": {
			"tool.sh": toolFile,
		},
		".bin": {
			// Symlink: .bin/my-tool -> ../my-tool-pkg/tool.sh
			"my-tool": tg.symlink("../my-tool-pkg/tool.sh"),
		},
	});

	// Include node_modules in the source artifact and set env vars in pre.
	// Make the source unique per invocation so the build is never cached. This
	// test validates runtime sandbox behavior, so a cached result would be a
	// false negative.
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
		pre: `export NODE_PATH="$SOURCE/node_modules" && export PATH="$PATH:$NODE_PATH/.bin"`,
		env: {
			TGRUSTC_TRACING: "tgrustc=trace",
		},
	});
	console.log("testRunnerPathTools result", result.id);

	// Assert the build script ran the tool and captured its output.
	const output = await $`runner-path-tools | tee ${tg.output}`
		.env(result)
		.then(tg.File.expect);
	const text = await output.text;
	tg.assert(
		text.includes("tool output from my-tool"),
		"Build script should have run my-tool from NODE_PATH/.bin.",
	);
};

/** Test that build script cfg probes via RUSTC_WRAPPER work in runner mode.
 *
 * Reproduces the rustix compilation failure in tangram.ts testProxy: rustix's
 * build script calls can_compile() which spawns RUSTC_WRAPPER (tgrustc) to
 * probe compiler capabilities. Without the fix, tgrustc-internal env vars
 * (TGRUSTC_RUNNER_DRIVER_MODE) leak into the child process, causing tgrustc
 * to enter runner driver mode instead of the stdin-passthrough path.
 */
export const testRunnerCfgProbe = async () => {
	// Make the source unique per invocation so the build is never cached. This
	// test validates runtime sandbox behavior, so a cached result would be a
	// false negative.
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

/** Test that the runner can execute wrapped tools in the sandbox.
 *
 * Reproduces the tangram.ts testProxy failure on Linux where `bunx tsgo` fails
 * because the runner sandbox does not have `/usr/bin/env` available, so
 * shebang-based scripts cannot resolve their interpreters. The fix wraps
 * shebang scripts with `std.wrap` using explicit interpreter binaries, making
 * them native ELF executables that don't need shebangs at all.
 */
export const testRunnerPathExec = async () => {
	const host = await std.triple.host();
	// Get the dash interpreter.
	const dashBin = await dash({ host })
		.then((d) => d.get("bin/dash"))
		.then(tg.File.expect);
	// Create a shell script tool, then wrap it so it doesn't need a shebang.
	const script = tg.file({
		contents: '#!/usr/bin/env sh\necho "hello from exec tool"\n',
		executable: true,
	});
	const tool = await std.wrap(script, { interpreter: dashBin, host });
	const toolDir = tg.directory({ bin: { "my-exec-tool": tool } });

	// Make the source unique per invocation so the build is never cached. This
	// test validates runtime sandbox behavior, so a cached result would be a
	// false negative.
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

export const test = async () => {
	// Ensure the proxy compiles before running other tests.
	await testProxyCompiles();
	// Run remaining tests in parallel.
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
	]);
};
