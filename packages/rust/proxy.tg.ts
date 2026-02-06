import * as std from "std" with { local: "../std" };
import { $ } from "std" with { local: "../std" };

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
 * Looks for `proxy_complete` tracing events in the format:
 * `proxy_complete crate_name=<name> elapsed_ms=<ms> cached=<true|false> process_id=<id> command_id=<id>`
 */
export const parseStats = async (
	result: tg.Directory,
): Promise<Array<RustcStats> | undefined> => {
	const stderrLog = await result
		.tryGet("cargo-stderr.log")
		.then((a) => (a instanceof tg.File ? a : undefined));
	if (!stderrLog) return undefined;

	const text = await stderrLog.text;
	const stats: Array<RustcStats> = [];

	// Parse proxy_complete lines from tracing output.
	// Format: ... proxy_complete crate_name=<name> elapsed_ms=<ms> cached=<bool> process_id=<id> command_id=<id> ...
	for (const line of text.split("\n")) {
		if (!line.includes("proxy_complete")) continue;

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
export const buildWithStats = (args: cargo.Arg) =>
	cargo.build({
		...args,
		proxy: true,
		captureStderr: true,
		env: std.env.arg(args.env, { TGRUSTC_TRACING: "tgrustc=info" }),
	});

/** Look up a crate's stats by name. */
const getCrateStatus = (stats: Array<RustcStats>, name: string) =>
	stats.find((s) => s.crate_name === name);

/** Configuration for the assertCacheHit helper. */
type CacheTestConfig = {
	source: tg.Directory;
	modifyPath: string;
	expectations: Record<string, boolean>;
	buildArgs?: Partial<cargo.Arg>;
	tag?: string;
};

/** Build, modify a file, rebuild, and assert cache hit/miss expectations.
 *
 * 1. Builds once to populate cache.
 * 2. Reads modifyPath from source, appends a unique comment.
 * 3. Rebuilds with buildWithStats.
 * 4. Parses stats from both builds.
 * 5. Asserts each crate in expectations matches its expected hit/miss.
 * 6. Returns both stat arrays and the second result directory.
 */
const assertCacheHit = async (
	config: CacheTestConfig,
): Promise<{
	first: Array<RustcStats>;
	second: Array<RustcStats>;
	secondResult: tg.Directory;
}> => {
	const { source, modifyPath, expectations, buildArgs, tag } = config;
	const comment = tag ?? "cache test modification";

	// First build to populate cache.
	const firstResult = await buildWithStats({ source, ...buildArgs });
	const firstStats = await parseStats(firstResult);

	// Modify the specified file.
	const originalText = await source
		.get(modifyPath)
		.then(tg.File.expect)
		.then((f: tg.File) => f.text);
	const modifiedSource = await tg.directory(source, {
		[modifyPath]: tg.file(`${originalText}\n// ${comment}\n`),
	});

	// Rebuild with modified source.
	const secondResult = await buildWithStats({
		source: modifiedSource,
		...buildArgs,
	});
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
		source: await tests.get("parallel-deps").then(tg.Directory.expect),
	});

	// Build project 2 - deps should be cached from project 1.
	const result = await buildWithStats({
		source: await tests.get("project-two").then(tg.Directory.expect),
	});
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

/** Test that unchanged workspace crates cache hit when a sibling is modified.
 *
 * Runs with both buildInTree: false and buildInTree: true to cover both code paths.
 */
export const testCacheHitUnchangedWorkspaceCrates = async () => {
	const workspaceExpectations = {
		cli: false,
		greeting: true,
		bytes: true,
	};

	const runVariant = async (buildInTree: boolean) => {
		const tag = buildInTree ? "workspace buildInTree" : "workspace default";
		const source = await tests.get("hello-workspace").then(tg.Directory.expect);
		const { second, secondResult } = await assertCacheHit({
			source,
			modifyPath: "packages/cli/src/main.rs",
			expectations: workspaceExpectations,
			buildArgs: { buildInTree },
			tag,
		});
		tg.assert(summarizeStats(second).hits >= 2);

		// Verify rebuilt binary works.
		const output = await $`cli | tee ${tg.output}`
			.env(secondResult)
			.then(tg.File.expect);
		tg.assert((await output.text).trim() === "Hello from a workspace!");
	};

	await runVariant(false);
	await runVariant(true);
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

/** Test proxy with buildInTree when source contains tangram.ts with external imports.
 *
 * This reproduces the bug where the tangram checkin process tries to resolve
 * local imports in tangram.ts files, failing when those imports point to paths
 * outside the temp build directory.
 *
 * Structure:
 * - Source contains a tangram.ts with `local: "../external.tg.ts"` import
 * - Build with buildInTree: true copies source to temp directory
 * - The relative import path doesn't exist in the temp directory
 * - The proxy should handle this gracefully
 */
export const testBuildInTreeWithExternalTsImport = async () => {
	const source = await tests.get("hello-workspace").then(tg.Directory.expect);

	// Add a tangram.ts file that imports from an external path (simulating the tangram repo structure).
	const sourceWithTangram = await tg.directory(source, {
		"tangram.ts": tg.file(`
// This import references a file outside the workspace
import foo from "foo" with { local: "../external-package/foo.tg.ts" };

export default foo;
`),
	});

	// Build with buildInTree: true.
	const result = await buildWithStats({
		source: sourceWithTangram,
		buildInTree: true,
	});

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

/** Test proxy with buildInTree for a workspace crate with build.rs at root.
 *
 * This reproduces the bug where build.rs files at the crate root (not under src/)
 * were not having their paths rewritten correctly. For a workspace like:
 *   crates/app/build.rs
 * The proxy needs to extract "crates/app" as the subpath so that
 * "crates/app/build.rs" gets rewritten to just "build.rs".
 */
export const testBuildInTreeWithBuildScript = async () => {
	const source = await tests
		.get("workspace-build-script")
		.then(tg.Directory.expect);

	const result = await buildWithStats({
		source,
		buildInTree: true,
	});

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

/** Test that DEP_* env vars from build scripts don't break caching. */
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
		buildArgs: { buildInTree: true },
	});
};

/** Test vendored crate caching with pre script that modifies PATH. */
export const testCacheHitWithPreScript = async () => {
	const source = await tests.get("vendor-cache-hit").then(tg.Directory.expect);
	const pre = await tg`
		mkdir -p "$SOURCE/node_modules/.bin"
		export PATH="$PATH:$SOURCE/node_modules/.bin"
	`;

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
		buildArgs: { buildInTree: true, useCargoVendor: true, pre },
	});
};

/** Test that -sys crate link paths don't break caching.
 *
 * Runs with both buildInTree: false and buildInTree: true to cover both
 * code paths. The buildInTree variant reproduces the issue where cc-rs
 * embeds temp source paths in .o files.
 */
export const testSysLinkCache = async () => {
	const sysLinkExpectations = {
		app: false,
		consumer: true,
		wrapper_sys: true,
		build_script_build: true,
	};

	const runVariant = async (buildInTree: boolean) => {
		const tag = buildInTree ? "sys-link buildInTree" : "sys-link default";
		const source = await tests.get("sys-link-cache").then(tg.Directory.expect);
		await assertCacheHit({
			source,
			modifyPath: "packages/app/src/main.rs",
			expectations: sysLinkExpectations,
			buildArgs: { buildInTree },
			tag,
		});
	};

	await runVariant(false);
	await runVariant(true);
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
		testBuildInTreeWithExternalTsImport(),
		testBuildInTreeWithBuildScript(),
		testMultiVersionCacheHit(),
		testAliasedExtern(),
		testPubUseReexport(),
		testXzNative(),
		testVendoredPubUse(),
		testCacheHitWithDepVars(),
		testCacheHitWithPreScript(),
		testSysLinkCache(),
	]);
};
