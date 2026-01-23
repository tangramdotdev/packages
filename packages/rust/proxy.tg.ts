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
import tests from "./tests" with { type: "directory" };

export const testProxyCompiles = async () => {
	// Make sure the proxy compiles and runs.
	const version = await $`tgrustc rustc - --version | tee ${tg.output}`
		.env(proxy())
		.env(self())
		.then(tg.File.expect);
	const versionText = await version.text();
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
	const helloText = await helloOutput.text();
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
	const testText = await testOutput.text();
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
	const opensslText = await opensslOutput.text();
	tg.assert(
		opensslText.trim() === "Hello, from a crate that links against libssl!",
	);
};

export const testWorkspace = async () => {
	// Build the workspace test.
	const helloWorkspace = await cargo.build({
		source: tests.get("hello-workspace").then(tg.Directory.expect),
		proxy: true,
		env: {
			TGRUSTC_TRACING: "tgrustc=trace",
			TGSTRIP_TRACING: "tgstrip=trace",
		},
	});
	console.log("helloWorkspace result", helloWorkspace.id);

	// Assert it produces the correct output.
	const workspaceOutput = await $`cli | tee ${tg.output}`
		.env(helloWorkspace)
		.then(tg.File.expect);
	const workspaceText = await workspaceOutput.text();
	tg.assert(workspaceText.trim() === "Hello from a workspace!");
};

export const testParallelDeps = async () => {
	// Build a project with dependencies that trigger parallel compilation.
	// This tests the race condition where multiple proxies check in the deps
	// directory simultaneously.
	const parallelDeps = await cargo.build({
		source: tests.get("parallel-deps").then(tg.Directory.expect),
		proxy: true,
		env: {
			TGRUSTC_TRACING: "tgrustc=trace",
		},
	});
	console.log("parallelDeps result", parallelDeps.id);

	// Assert it produces the correct output.
	const output = await $`parallel-deps | tee ${tg.output}`
		.env(parallelDeps)
		.then(tg.File.expect);
	const text = await output.text();
	tg.assert(text.includes("Found 2 matches"));
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
	const text = await output.text();
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
	const text = await output.text();
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
	const text1 = await output1.text();
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
	const text2 = await output2.text();
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
	const text = await output.text();
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
	const text = await output.text();
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
	const text = await output.text();
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
	const text = await output.text();
	tg.assert(text.trim() === "6 * 7 = 42");
};

/** Stats from tgrustc proxy JSONL file. */
type RustcStats = {
	crate_name: string;
	cached: boolean;
	elapsed_ms: number;
	process_id: string;
	command_id: string;
};

/** Parse tgrustc stats from a build result. */
const parseStats = async (
	result: tg.Directory,
): Promise<Array<RustcStats> | undefined> => {
	const statsFile = await result
		.tryGet("tgrustc-stats.jsonl")
		.then((a) => (a instanceof tg.File ? a : undefined));
	if (!statsFile) return undefined;
	const text = await statsFile.text();
	return text
		.trim()
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line) as RustcStats);
};

/** Summarize stats: count cache hits/misses and total time. */
const summarizeStats = (stats: Array<RustcStats>) => {
	const hits = stats.filter((s) => s.cached).length;
	const misses = stats.filter((s) => !s.cached).length;
	const totalMs = stats.reduce((sum, s) => sum + s.elapsed_ms, 0);
	return { hits, misses, totalMs, crates: stats.length };
};

/** Test that vendored dependencies cache hit when the main crate changes.
 *
 * Uses source modifications to create unique Tangram cache keys. Only main.rs
 * is modified between builds, so vendored deps remain identical and should hit
 * the tgrustc cache on subsequent proxy builds.
 */
export const testCacheHitVendoredDeps = async () => {
	const source = await tests.get("parallel-deps").then(tg.Directory.expect);
	const mainRs = await source
		.get("src/main.rs")
		.then(tg.File.expect)
		.then((f: tg.File) => f.text());

	// Helper to create a source variant with a unique comment in main.rs.
	const sourceVariant = (tag: string) =>
		tg.directory(source, {
			"src/main.rs": tg.file(`${mainRs}\n// ${tag}\n`),
		});

	// Warmup build to ensure vendoring, SDK, toolchain, and proxy are cached.
	await cargo.build({
		source: await sourceVariant("warmup"),
		proxy: true,
	});

	// Cold builds - source variant makes each a unique Tangram cache key.
	const t1 = Date.now();
	await cargo.build({
		source: await sourceVariant("cold-no-proxy"),
		proxy: false,
	});
	const noProxyCold = Date.now() - t1;

	// Proxy cold build populates tgrustc cache for deps.
	const t2 = Date.now();
	const coldProxyResult = await cargo.build({
		source: await sourceVariant("cold-proxy"),
		proxy: true,
		env: { TGRUSTC_TRACING: "tgrustc=info" },
	});
	const proxyCold = Date.now() - t2;
	const coldProxyStats = await parseStats(coldProxyResult);

	// Incremental builds - proxy should benefit from cached deps.
	const t3 = Date.now();
	await cargo.build({
		source: await sourceVariant("incr-no-proxy"),
		proxy: false,
	});
	const noProxyIncr = Date.now() - t3;

	// Proxy incremental - deps should be cache hits.
	const t4 = Date.now();
	const incrProxyResult = await cargo.build({
		source: await sourceVariant("incr-proxy"),
		proxy: true,
		env: { TGRUSTC_TRACING: "tgrustc=info" },
	});
	const proxyIncr = Date.now() - t4;
	const incrProxyStats = await parseStats(incrProxyResult);

	console.log("cold", { noProxy: noProxyCold, proxy: proxyCold });
	console.log("incremental", { noProxy: noProxyIncr, proxy: proxyIncr });

	if (coldProxyStats) {
		console.log("cold proxy stats", summarizeStats(coldProxyStats));
		console.log(
			"cold crates",
			coldProxyStats.map(
				(s) =>
					`${s.crate_name}: ${s.cached ? "HIT" : "MISS"} cmd=${s.command_id}`,
			),
		);
	}
	if (!incrProxyStats) {
		throw new Error("incremental proxy build should have stats");
	}

	console.log("incr proxy stats", summarizeStats(incrProxyStats));
	console.log(
		"incr crates",
		incrProxyStats.map(
			(s) =>
				`${s.crate_name}: ${s.cached ? "HIT" : "MISS"} cmd=${s.command_id}`,
		),
	);

	// Compare command IDs between cold and incr for same crates.
	if (coldProxyStats) {
		console.log("=== Command ID comparison ===");
		for (const incrStat of incrProxyStats) {
			const coldStat = coldProxyStats.find(
				(s) => s.crate_name === incrStat.crate_name,
			);
			if (coldStat) {
				const match = coldStat.command_id === incrStat.command_id;
				console.log(
					`${incrStat.crate_name}: ${match ? "SAME" : "DIFFERENT"} (cold=${coldStat.command_id}, incr=${incrStat.command_id})`,
				);
			}
		}
	}

	// Assertions: Incremental build should cache hit for dependencies.
	// Only the main crate (parallel-deps) should miss since main.rs changed.
	const getCrateStatus = (name: string) =>
		incrProxyStats.find((s) => s.crate_name === name);

	const mainCrate = getCrateStatus("parallel_deps");
	const ahoCorasick = getCrateStatus("aho_corasick");
	const regexSyntax = getCrateStatus("regex_syntax");
	const memchr = getCrateStatus("memchr");

	// Main crate should miss (we modified main.rs).
	tg.assert(
		mainCrate?.cached === false,
		`parallel_deps should be a cache miss (modified), got ${mainCrate?.cached}`,
	);

	// Dependencies should hit (vendored, unchanged).
	tg.assert(
		ahoCorasick?.cached === true,
		`aho_corasick should be a cache hit (vendored dep), got ${ahoCorasick?.cached}`,
	);
	tg.assert(
		regexSyntax?.cached === true,
		`regex_syntax should be a cache hit (vendored dep), got ${regexSyntax?.cached}`,
	);
	tg.assert(
		memchr?.cached === true,
		`memchr should be a cache hit (vendored dep), got ${memchr?.cached}`,
	);

	// Summary: should have at least 3 hits (the deps) and 1 miss (main crate).
	const summary = summarizeStats(incrProxyStats);
	tg.assert(
		summary.hits >= 3,
		`incremental build should have at least 3 cache hits, got ${summary.hits}`,
	);
	tg.assert(
		summary.misses >= 1,
		`incremental build should have at least 1 cache miss, got ${summary.misses}`,
	);
	return { cold: coldProxyStats, incr: incrProxyStats };
};

/** Test that different projects with the same dependencies share cached builds. */
export const testCacheHitSharedDepsAcrossProjects = async () => {
	const project1 = await tests.get("parallel-deps").then(tg.Directory.expect);

	// Build project 1.
	const project1Result = await cargo.build({
		source: project1,
		proxy: true,
		env: { TGRUSTC_TRACING: "tgrustc=info" },
	});
	const project1Stats = await parseStats(project1Result);
	if (project1Stats) {
		console.log("project1 stats", summarizeStats(project1Stats));
		console.log("=== Project 1 command IDs ===");
		for (const s of project1Stats) {
			console.log(`  ${s.crate_name}: cmd=${s.command_id}`);
		}
	}

	// Project 2: same dependency versions, different code.
	const project2 = await tests.get("project-two").then(tg.Directory.expect);

	// Build project 2 - deps should be cached from project 1.
	const result = await cargo.build({
		source: project2,
		proxy: true,
		env: { TGRUSTC_TRACING: "tgrustc=info" },
	});
	console.log("result", result.id);
	const project2Stats = await parseStats(result);
	if (!project2Stats) {
		throw new Error("project2 build should have stats");
	}

	const summary = summarizeStats(project2Stats);
	console.log("project2 stats", summary);
	console.log(
		"project2 crates",
		project2Stats.map((s) => `${s.crate_name}: ${s.cached ? "HIT" : "MISS"}`),
	);
	console.log("=== Project 2 command IDs ===");
	for (const s of project2Stats) {
		console.log(`  ${s.crate_name}: cmd=${s.command_id}`);
	}
	// Compare command IDs.
	if (project1Stats) {
		console.log("=== Command ID comparison ===");
		for (const s2 of project2Stats) {
			const s1 = project1Stats.find((s) => s.crate_name === s2.crate_name);
			if (s1) {
				const match = s1.command_id === s2.command_id;
				console.log(`  ${s2.crate_name}: ${match ? "SAME" : "DIFFERENT"}`);
			}
		}
	}

	// Assertions: shared dependencies should hit, project-two crate should miss.
	const getCrateStatus = (name: string) =>
		project2Stats.find((s) => s.crate_name === name);

	const project2Status = getCrateStatus("project_two");
	const ahoCorasick = getCrateStatus("aho_corasick");
	const regexSyntax = getCrateStatus("regex_syntax");
	const memchr = getCrateStatus("memchr");

	tg.assert(
		project2Status?.cached === false,
		`project_two should be a cache miss (new crate), got ${project2Status?.cached}`,
	);
	tg.assert(
		ahoCorasick?.cached === true,
		`aho_corasick should be a cache hit (shared dep), got ${ahoCorasick?.cached}`,
	);
	tg.assert(
		regexSyntax?.cached === true,
		`regex_syntax should be a cache hit (shared dep), got ${regexSyntax?.cached}`,
	);
	tg.assert(
		memchr?.cached === true,
		`memchr should be a cache hit (shared dep), got ${memchr?.cached}`,
	);

	// Summary: should have at least 3 hits (the deps) and 1 miss (new crate).
	tg.assert(
		summary.hits >= 3,
		`should have at least 3 cache hits, got ${summary.hits}`,
	);

	const output = await $`project-two | tee ${tg.output}`
		.env(result)
		.then(tg.File.expect);
	tg.assert((await output.text()).includes("project 2"));
	return { project1: project1Stats, project2: project2Stats };
};

/** Test that unchanged workspace crates cache hit when a sibling is modified.
 *
 * Structure:
 * - hello-workspace has: cli (depends on greeting + bytes), greeting (lib)
 * - Initial build populates the cache
 * - Modify only cli/src/main.rs
 * - Rebuild: greeting and bytes should cache hit, only cli should miss
 */
export const testCacheHitUnchangedWorkspaceCrates = async () => {
	const source = await tests.get("hello-workspace").then(tg.Directory.expect);

	// Initial build to populate the cache.
	console.log("=== Initial workspace build (populating cache) ===");
	const initialResult = await cargo.build({
		source,
		proxy: true,
		env: { TGRUSTC_TRACING: "tgrustc=info" },
	});
	const initialStats = await parseStats(initialResult);
	if (initialStats) {
		const summary = summarizeStats(initialStats);
		console.log("initial build stats", summary);
		console.log(
			"initial crates",
			initialStats.map((s) => `${s.crate_name}: ${s.cached ? "HIT" : "MISS"}`),
		);
	}

	// Verify initial build works.
	const initialOutput = await $`cli | tee ${tg.output}`
		.env(initialResult)
		.then(tg.File.expect);
	tg.assert((await initialOutput.text()).trim() === "Hello from a workspace!");

	// Modify only the cli crate - add a comment to main.rs.
	const cliMainRs = await source
		.get("packages/cli/src/main.rs")
		.then(tg.File.expect)
		.then((f: tg.File) => f.text());

	const modifiedSource = await tg.directory(source, {
		"packages/cli/src/main.rs": tg.file(
			`${cliMainRs}\n// Modified for cache test\n`,
		),
	});

	// Rebuild with modified cli.
	console.log("=== Rebuild with modified cli (testing cache hits) ===");
	const rebuiltResult = await cargo.build({
		source: modifiedSource,
		proxy: true,
		env: { TGRUSTC_TRACING: "tgrustc=info" },
	});
	const rebuiltStats = await parseStats(rebuiltResult);
	if (!rebuiltStats || !initialStats) {
		throw new Error("rebuilt build should have stats");
	}

	const summary = summarizeStats(rebuiltStats);
	console.log("rebuilt stats", summary);
	console.log(
		"rebuilt crates",
		rebuiltStats.map((s) => `${s.crate_name}: ${s.cached ? "HIT" : "MISS"}`),
	);

	// Analyze cache behavior by crate type.
	const getCrateStatus = (name: string) =>
		rebuiltStats.find((s) => s.crate_name === name);
	const getInitialStatus = (name: string) =>
		initialStats.find((s) => s.crate_name === name);

	const cliStatus = getCrateStatus("cli");
	const greetingStatus = getCrateStatus("greeting");
	const bytesStatus = getCrateStatus("bytes");

	console.log("=== Cache Analysis ===");
	console.log(
		`cli (modified workspace crate): ${cliStatus?.cached ? "HIT" : "MISS"}`,
	);
	console.log(
		`greeting (unchanged workspace crate): ${greetingStatus?.cached ? "HIT" : "MISS"}`,
	);
	console.log(
		`bytes (vendored dependency): ${bytesStatus?.cached ? "HIT" : "MISS"}`,
	);

	// Command ID comparison for debugging.
	console.log("=== Command ID Comparison ===");
	for (const stat of rebuiltStats) {
		const initial = getInitialStatus(stat.crate_name);
		const match = initial?.command_id === stat.command_id;
		console.log(
			`${stat.crate_name}: ${match ? "SAME" : "DIFFERENT"} (initial=${initial?.command_id}, rebuilt=${stat.command_id})`,
		);
	}

	// Assertions for expected cache behavior.
	// - cli: MISS (we modified it)
	// - greeting: HIT (unchanged workspace crate)
	// - bytes: HIT (vendored dependency, never changes)
	tg.assert(
		cliStatus?.cached === false,
		`cli should be a cache miss (modified), got ${cliStatus?.cached}`,
	);
	tg.assert(
		greetingStatus?.cached === true,
		`greeting should be a cache hit (unchanged workspace crate), got ${greetingStatus?.cached}`,
	);
	tg.assert(
		bytesStatus?.cached === true,
		`bytes should be a cache hit (vendored dependency), got ${bytesStatus?.cached}`,
	);

	// Verify summary: should have at least 2 hits and exactly 1 miss.
	tg.assert(
		summary.hits >= 2,
		`should have at least 2 cache hits, got ${summary.hits}`,
	);

	// Verify rebuilt binary works.
	const rebuiltOutput = await $`cli | tee ${tg.output}`
		.env(rebuiltResult)
		.then(tg.File.expect);
	tg.assert((await rebuiltOutput.text()).trim() === "Hello from a workspace!");
	return { initial: initialStats, rebuilt: rebuiltStats };
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
	const text = await output.text();
	tg.assert(text.includes("crossterm"));

	return result;
};

export const test = async () => {
	// Ensure the proxy compiles before running other tests.
	await testProxyCompiles();
	// Run remaining tests in parallel.
	await Promise.all([
		testHello(),
		testPkgconfig(),
		testOpenSSL(),
		testWorkspace(),
		testParallelDeps(),
		testProcMacro(),
		testBuildScriptCodegen(),
		testBuildScriptEnvDep(),
		testBuildScriptFileDep(),
		testCcRs(),
		testProcMacroWithDeps(),
		testCacheHitVendoredDeps(),
		testCacheHitSharedDepsAcrossProjects(),
		testCacheHitUnchangedWorkspaceCrates(),
	]);
};
