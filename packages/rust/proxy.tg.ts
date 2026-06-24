import * as std from "std" with { source: "../std" };
import { $ } from "std" with { source: "../std" };
import dash from "dash" with { source: "../dash.tg.ts" };
import { libclang } from "llvm" with { source: "../llvm" };
import openssl from "openssl" with { source: "../openssl.tg.ts" };
import pkgconf from "pkgconf" with { source: "../pkgconf.tg.ts" };
import xz from "xz" with { source: "../xz.tg.ts" };

import { cargo, rustTriple, self, VERSION } from "./tangram.ts";

import cargoToml from "./tgrustc/Cargo.toml" with { type: "file" };
import cargoLock from "./tgrustc/Cargo.lock" with { type: "file" };
import src from "./tgrustc/src" with { type: "directory" };

import probeFixture from "./tgrustc/tests/probe" with { type: "directory" };
import tests from "./tests" with { type: "directory" };

/** `../../std` from tgrustc's Cargo.toml resolves to the std Rust workspace. */
export async function source() {
	return tg.directory({
		"rust/tgrustc": {
			"Cargo.toml": cargoToml,
			"Cargo.lock": cargoLock,
			src,
		},
		std: std.rustSource,
	});
}

export async function proxy(...args: std.Args<cargo.Arg>) {
	return cargo.build(
		{
			source: source(),
			manifestSubdir: "rust/tgrustc",
			proxy: false,
			profile: "dev",
			useCargoVendor: true,
		},
		...args,
	);
}

/** Cargo run command that wires tgrustc as RUSTC_WRAPPER over the
 *  hello-proc-macro-deps fixture. Used by test-remote-cache.nu: cargo runs on
 *  the host (target/ on host), only rustc invocations spawn sandbox processes.
 *  Each sandbox process must produce a portable cache key for cross-machine
 *  reuse, which is what the remote-cache test validates.
 *
 *  `TGRUSTC_SANDBOX_TOOLCHAIN` and `TGRUSTC_SANDBOX_SDK` override what the
 *  wrapper places inside the sub-sandbox. The host rustup toolchain is not
 *  sandbox-safe (its rustc has a host-system ELF interpreter); the
 *  `std.wrap`-ed `self()` toolchain is. The SDK provides `cc` for rustc's
 *  linker step on final binaries. */
export async function runProcMacroDeps() {
	const wrapper = await proxy();
	const source = await tests
		.get("hello-proc-macro-deps")
		.then(tg.Directory.expect);
	const host = std.triple.host();
	const rustHost = rustTriple(host);
	const sandboxToolchain = await self({ host: rustHost, channel: "stable" });
	const sdkArgs: Array<std.sdk.Arg> = [{ host: rustHost, target: rustHost }];
	if (std.triple.os(rustHost) === "linux") {
		sdkArgs.push({ toolchain: "gnu" });
	}
	const sandboxSdk = await std.sdk(...sdkArgs);
	return cargo.run({
		source,
		proxy: false,
		env: {
			RUSTC_WRAPPER: tg`${wrapper}/bin/tgrustc`,
			TGRUSTC_SANDBOX_TOOLCHAIN: sandboxToolchain,
			TGRUSTC_SANDBOX_SDK: sandboxSdk,
		},
		pre: 'export TGRUSTC_PASSTHROUGH_PROJECT_DIR="$PWD"',
	});
}

/** Phase-4: workspace with proc-macro crate + crates.io deps. */
export async function testProcMacroDeps() {
	const wrapper = await proxy();
	const source = await tests
		.get("hello-proc-macro-deps")
		.then(tg.Directory.expect);

	const result = await cargo.build({
		source,
		proxy: false,
		captureStderr: true,
		env: {
			RUSTC_WRAPPER: tg`${wrapper}/bin/tgrustc`,
			CARGO_BUILD_PIPELINING: "false",
		},
	});
	console.log("testProcMacroDeps result", result.id);

	const out = await $`app | tee ${tg.output}`.env(result).then(tg.File.expect);
	const text = await out.text;
	tg.assert(
		text.trim() === "Hello from Greeter!",
		`unexpected output: ${text}`,
	);
	return result;
}

/** Phase-3: single crate with build.rs that writes generated.rs into OUT_DIR. */
export async function testCodegen() {
	const wrapper = await proxy();
	const source = await tests.get("hello-codegen").then(tg.Directory.expect);

	const result = await cargo.build({
		source,
		proxy: false,
		env: {
			RUSTC_WRAPPER: tg`${wrapper}/bin/tgrustc`,
		},
	});
	console.log("testCodegen result", result.id);

	const out = await $`hello-codegen | tee ${tg.output}`
		.env(result)
		.then(tg.File.expect);
	const text = await out.text;
	tg.assert(
		text.trim() === "generated at build time",
		`unexpected output: ${text}`,
	);
	return result;
}

/** Phase-5: hello-workspace with proxy + passthrough. Workspace members compile via passthrough on host rustc; vendored deps go through tangram sandbox processes. */
export async function testWorkspaceMode2() {
	const wrapper = await proxy();
	const source = await tests.get("hello-workspace").then(tg.Directory.expect);

	const result = await cargo.build({
		source,
		proxy: false,
		captureStderr: true,
		verbose: true,
		env: {
			RUSTC_WRAPPER: tg`${wrapper}/bin/tgrustc`,
		},
		pre: tg`export TGRUSTC_PASSTHROUGH_PROJECT_DIR="$TGRUSTC_SOURCE_DIR"`,
	});
	console.log("testWorkspaceMode2 result", result.id);

	const stderrLog = await result
		.tryGet("cargo-stderr.log")
		.then((a) => (a instanceof tg.File ? a : undefined));
	if (stderrLog) {
		const text = await stderrLog.text;
		console.log("cargo stderr (first 4000 chars):\n", text.slice(0, 4000));
	}

	const out = await $`cli | tee ${tg.output}`.env(result).then(tg.File.expect);
	const text = await out.text;
	tg.assert(
		text.trim() === "Hello from a workspace!",
		`unexpected output: ${text}`,
	);
	return result;
}

/** Phase-2: workspace with cli + greeting lib. Exercises --extern and -L. */
export async function testWorkspace() {
	const wrapper = await proxy();
	const source = await tests.get("hello-workspace").then(tg.Directory.expect);

	const result = await cargo.build({
		source,
		proxy: false,
		captureStderr: true,
		verbose: true,
		env: {
			RUSTC_WRAPPER: tg`${wrapper}/bin/tgrustc`,
		},
	});
	console.log("testWorkspace result", result.id);

	const stderrLog = await result
		.tryGet("cargo-stderr.log")
		.then((a) => (a instanceof tg.File ? a : undefined));
	if (stderrLog) {
		const text = await stderrLog.text;
		console.log("cargo stderr (first 4000 chars):\n", text.slice(0, 4000));
	}

	const out = await $`cli | tee ${tg.output}`.env(result).then(tg.File.expect);
	const text = await out.text;
	tg.assert(
		text.trim() === "Hello from a workspace!",
		`unexpected output: ${text}`,
	);
	return result;
}

/** Phase-1 probe: build a tiny single-bin cargo project with tgrustc as RUSTC_WRAPPER. */
export async function testProbe() {
	const wrapper = await proxy();

	const result = await cargo.build({
		source: probeFixture,
		proxy: false,
		env: {
			RUSTC_WRAPPER: tg`${wrapper}/bin/tgrustc`,
		},
	});
	console.log("testProbe result", result.id);

	const out = await $`probe | tee ${tg.output}`
		.env(result)
		.then(tg.File.expect);
	const text = await out.text;
	tg.assert(text.trim() === "hi from tgrustc", `unexpected output: ${text}`);
	return result;
}

/** Legacy fixture: hello-world with build.rs, OUT_DIR, include_bytes!, itoa vendored. */
export async function testHello() {
	const result = await cargo.build({
		source: tests.get("hello-world").then(tg.Directory.expect),
		proxy: true,
	});
	console.log("testHello result", result.id);

	const out = await $`hello-world | tee ${tg.output}`
		.env(result)
		.then(tg.File.expect);
	const text = await out.text;
	tg.assert(
		text.trim() === "hello, proxy!\n128\nHello, build!",
		`unexpected output: ${text}`,
	);
}

/** Legacy fixture: single proc-macro crate (no external deps). */
export async function testProcMacro() {
	const result = await cargo.build({
		source: tests.get("hello-proc-macro").then(tg.Directory.expect),
		proxy: true,
	});
	console.log("testProcMacro result", result.id);

	const out = await $`app | tee ${tg.output}`.env(result).then(tg.File.expect);
	const text = await out.text;
	tg.assert(
		text.trim() === "Hello from Greeter!",
		`unexpected output: ${text}`,
	);
}

/** Legacy fixture: same as testProcMacroDeps but via the proxy=true flow. */
export async function testProcMacroWithDeps() {
	const result = await cargo.build({
		source: tests.get("hello-proc-macro-deps").then(tg.Directory.expect),
		proxy: true,
	});
	console.log("testProcMacroWithDeps result", result.id);

	const out = await $`app | tee ${tg.output}`.env(result).then(tg.File.expect);
	const text = await out.text;
	tg.assert(
		text.trim() === "Hello from Greeter!",
		`unexpected output: ${text}`,
	);
}

/** Legacy smoke test: invoke the wrapper directly to print rustc --version. */
export async function testProxyCompiles() {
	const version = await $`tgrustc rustc - --version | tee ${tg.output}`
		.env(proxy())
		.env(self())
		.then(tg.File.expect);
	const versionText = await version.text;
	tg.assert(
		versionText.trim().includes(VERSION),
		`unexpected version output: ${versionText}`,
	);
}

/** Legacy fixture: links against a custom pkgconfig-provided dylib. */
export async function testPkgconfig() {
	const host = std.triple.host();
	const os = std.triple.os(host);
	const dylibExt = os === "darwin" ? "dylib" : "so";

	const fixture = await tests.get("hello-c-dylib").then(tg.Directory.expect);

	let externalLibDir = await $`
		mkdir -p ${tg.output}/lib
		mkdir -p ${tg.output}/include
		gcc -shared -fPIC ${fixture}/src/lib.c -o ${tg.output}/lib/libexternal.${dylibExt}
		cp ${fixture}/src/lib.h ${tg.output}/include/lib.h`
		.env(std.sdk())
		.then(tg.Directory.expect);

	externalLibDir = await tg.directory(externalLibDir, {
		["lib/pkgconfig/external.pc"]: tg.file`
				prefix=/tmp/external-pkgconfig-prefix
				exec_prefix=\${prefix}
				libdir=\${exec_prefix}/lib
				includedir=\${prefix}/include

				Name: external
				Description: Example shared library
				Version: 1.0.0
				Libs: -L\${libdir} -lexternal
				Cflags: -I\${includedir}`,
	});

	const result = await cargo.build({
		source: fixture,
		pre: "set -x",
		env: std.env.arg(pkgconf(), externalLibDir),
		parallelJobs: 1,
		proxy: true,
		verbose: true,
	});
	console.log("testPkgconfig result", result.id);

	const out = await $`myapp | tee ${tg.output}`
		.env(result)
		.then(tg.File.expect);
	const text = await out.text;
	tg.assert(
		text.trim() === "You passed the number: 42",
		`unexpected output: ${text}`,
	);
}

/** Legacy fixture: links against system openssl via openssl-sys. */
export async function testOpenSSL() {
	const result = await cargo.build({
		source: tests.get("hello-openssl").then(tg.Directory.expect),
		env: std.env.arg(openssl(), pkgconf()),
		parallelJobs: 1,
		proxy: true,
		verbose: true,
	});
	console.log("testOpenSSL result", result.id);

	const out = await $`hello-openssl | tee ${tg.output}`
		.env(result)
		.then(tg.File.expect);
	const text = await out.text;
	tg.assert(
		text.trim() === "Hello, from a crate that links against libssl!",
		`unexpected output: ${text}`,
	);
}

/** Legacy fixture: bindgen requires libclang from LLVM. */
export async function testBindgen() {
	const result = await cargo.build({
		source: tests.get("hello-bindgen").then(tg.Directory.expect),
		proxy: true,
		env: std.env.arg(libclang()),
	});
	console.log("testBindgen result", result.id);

	const out = await $`hello-bindgen | tee ${tg.output}`
		.env(result)
		.then(tg.File.expect);
	const text = await out.text;
	tg.assert(text.trim() === "6 * 7 = 42", `unexpected output: ${text}`);
}

/** Legacy fixture: build script reads MY_BUILD_VAR; different values bust cache. */
export async function testBuildScriptEnvDep() {
	const source = await tests.get("hello-env-dep").then(tg.Directory.expect);
	const build1 = await cargo.build({
		source,
		proxy: true,
		env: { MY_BUILD_VAR: "first_value" },
	});
	console.log("testBuildScriptEnvDep build1 result", build1.id);
	const out1 = await $`hello-env-dep | tee ${tg.output}`
		.env(build1)
		.then(tg.File.expect);
	tg.assert(
		(await out1.text).includes("first_value"),
		"first_value not present in build1 output",
	);

	const build2 = await cargo.build({
		source,
		proxy: true,
		env: { MY_BUILD_VAR: "second_value" },
	});
	console.log("testBuildScriptEnvDep build2 result", build2.id);
	const out2 = await $`hello-env-dep | tee ${tg.output}`
		.env(build2)
		.then(tg.File.expect);
	tg.assert(
		(await out2.text).includes("second_value"),
		"second_value not present in build2 output",
	);
}

/** Legacy fixture: build script reads a file from the source tree. */
export async function testBuildScriptFileDep() {
	const result = await cargo.build({
		source: tests.get("hello-file-dep").then(tg.Directory.expect),
		proxy: true,
	});
	console.log("testBuildScriptFileDep result", result.id);

	const out = await $`hello-file-dep | tee ${tg.output}`
		.env(result)
		.then(tg.File.expect);
	tg.assert(
		(await out.text).includes("hello from config file"),
		`unexpected output: ${await out.text}`,
	);
}

/** Legacy fixture: cross-compile proc-macro (proc macros build for host; bin builds for target). */
export async function testProcMacroCross() {
	const hostTriple = std.triple.host();
	const hostArch = std.triple.arch(hostTriple);
	const targetArch = hostArch === "x86_64" ? "aarch64" : "x86_64";
	const targetTriple = std.triple.create(hostTriple, { arch: targetArch });

	const result = await cargo.build({
		source: tests.get("hello-proc-macro").then(tg.Directory.expect),
		proxy: true,
		target: targetTriple,
	});
	console.log("testProcMacroCross result", result.id);

	const app = await result.get("bin/app").then(tg.File.expect);
	tg.assert(app !== undefined, "cross-compiled bin/app should exist");
	return result;
}

/** Legacy fixture: tangram.ts with external import does not break the proxy. */
export async function testExternalTsImport() {
	const source = await tests.get("hello-workspace").then(tg.Directory.expect);
	const sourceWithTangram = tg.directory(source, {
		"tangram.ts": tg.file(`
import foo from "foo" with { source: "../external-package/foo.tg.ts" };
export default foo;
`),
	});

	const result = await cargo.build({
		source: sourceWithTangram,
		proxy: true,
	});

	const out = await $`cli | tee ${tg.output}`.env(result).then(tg.File.expect);
	tg.assert(
		(await out.text).trim() === "Hello from a workspace!",
		`unexpected output: ${await out.text}`,
	);
	return result;
}

/** Legacy fixture: passthrough mode + proxy. Old wrapper emitted "passthrough mode" /
 *  "spawned process" trace lines; new wrapper does not, so the trace-text
 *  assertions are dropped and only the binary output is checked. */
export async function testPassthrough() {
	const source = await tests.get("hello-workspace").then(tg.Directory.expect);
	const result = await cargo.build({
		source,
		proxy: true,
		env: { TGRUSTC_PASSTHROUGH_PROJECT_DIR: tg`${source}` },
	});

	const out = await $`${result}/bin/cli | tee ${tg.output}`.then(
		tg.File.expect,
	);
	tg.assert(
		(await out.text).trim() === "Hello from a workspace!",
		`unexpected output: ${await out.text}`,
	);
	return result;
}

/** Legacy fixture: crossterm — exercises CARGO_MANIFEST_DIR for proc-macros. */
export async function testProxyCrossterm() {
	const result = await cargo.build({
		source: tests.get("hello-crossterm").then(tg.Directory.expect),
		proxy: true,
	});
	console.log("testProxyCrossterm result", result.id);

	const out = await $`hello-crossterm | tee ${tg.output}`
		.env(result)
		.then(tg.File.expect);
	tg.assert(
		(await out.text).includes("crossterm"),
		`unexpected output: ${await out.text}`,
	);
	return result;
}

/** Legacy fixture: -L native paths from xz must not reference outer-build tmp. */
export async function testXzNative() {
	const result = await cargo.build({
		source: tests.get("xz-native").then(tg.Directory.expect),
		proxy: true,
		env: std.env.arg(xz()),
	});
	console.log("testXzNative result", result.id);
	return result;
}

/** Legacy fixture: vendored transitive deps via hashbrown's deps. */
export async function testVendoredTransitiveDeps() {
	const result = await cargo.build({
		source: tests.get("vendored-transitive").then(tg.Directory.expect),
		proxy: true,
	});
	console.log("testVendoredTransitiveDeps result", result.id);

	const out = await $`vendored-transitive | tee ${tg.output}`
		.env(result)
		.then(tg.File.expect);
	tg.assert(
		(await out.text).includes("Success!"),
		`unexpected output: ${await out.text}`,
	);
	return result;
}

/** Legacy fixture: `--extern alias=lib...` where alias differs from crate name. */
export async function testAliasedExtern() {
	const result = await cargo.build({
		source: tests.get("aliased-extern").then(tg.Directory.expect),
		proxy: true,
	});
	console.log("testAliasedExtern result", result.id);
	return result;
}

/** Legacy fixture: `pub use crate as alias` re-export. */
export async function testPubUseReexport() {
	const result = await cargo.build({
		source: tests.get("pub-use-reexport").then(tg.Directory.expect),
		proxy: true,
	});
	console.log("testPubUseReexport result", result.id);
	return result;
}

/** Legacy fixture: vendored pub-use stress for parallel compilation. */
export async function testVendoredPubUse() {
	const result = await cargo.build({
		source: tests.get("vendored-pub-use").then(tg.Directory.expect),
		proxy: true,
	});
	console.log("testVendoredPubUse result", result.id);

	const out = await $`vendored-pub-use | tee ${tg.output}`
		.env(result)
		.then(tg.File.expect);
	tg.assert(
		(await out.text).includes("all crates compiled successfully"),
		`unexpected output: ${await out.text}`,
	);
	return result;
}

/** Legacy fixture: missing-externs fallback (old wrapper relied on TGRUSTC_TEST_SKIP_EXTERNS).
 *  The new wrapper does not maintain externs sidecars; this test may need adaptation. */
export async function testMissingExternsFallback() {
	const result = await cargo.build({
		source: tests.get("missing-externs").then(tg.Directory.expect),
		proxy: true,
	});
	console.log("testMissingExternsFallback result", result.id);

	const out = await $`top | tee ${tg.output}`.env(result).then(tg.File.expect);
	tg.assert(
		(await out.text).trim() === "result: 43",
		`Expected "result: 43", got "${(await out.text).trim()}"`,
	);
	return result;
}

/** Per-spawn observability emitted by the wrapper. Currently unused — the
 * new wrapper does not emit tracing lines, so `parseStats` returns undefined
 * and tests that depend on it fail until cache-hit observability is added. */
export type RustcStats = {
	crate_name: string;
	cached: boolean;
	elapsed_ms: number;
	process_id: string;
	command_id: string;
};

export async function parseStats(
	result: tg.Directory,
	eventName: string = "proxy_complete",
): Promise<Array<RustcStats> | undefined> {
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
}

export function summarizeStats(stats: Array<RustcStats>) {
	const hits = stats.filter((s) => s.cached).length;
	const misses = stats.filter((s) => !s.cached).length;
	const totalMs = stats.reduce((sum, s) => sum + s.elapsed_ms, 0);
	return { hits, misses, totalMs, crates: stats.length };
}

export function buildWithStats(...args: std.Args<cargo.Arg>) {
	return cargo.build(...args, {
		proxy: true,
		captureStderr: true,
	});
}

function getCrateStatus(stats: Array<RustcStats>, name: string) {
	return stats.find((s) => s.crate_name === name);
}

type CacheTestConfig = {
	source: tg.Directory;
	modifyPath: string;
	expectations: Record<string, boolean>;
	buildArgs?: std.Args<cargo.Arg>;
	tag?: string;
};

const cacheTestArgs: cargo.Arg = {
	proxy: true,
	captureStderr: true,
};

async function assertCacheHit(config: CacheTestConfig): Promise<{
	first: Array<RustcStats>;
	second: Array<RustcStats>;
	secondResult: tg.Directory;
}> {
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
}

export async function testCacheHitVendoredDeps() {
	const source = await tests.get("parallel-deps").then(tg.Directory.expect);
	await cargo.build({ source, proxy: true });
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
	tg.assert(summarizeStats(second).hits >= 2);
	const out = await $`parallel-deps | tee ${tg.output}`
		.env(secondResult)
		.then(tg.File.expect);
	tg.assert((await out.text).trim().length > 0);
}

export async function testCacheHitSharedDepsAcrossProjects() {
	await buildWithStats({
		source: tests.get("parallel-deps").then(tg.Directory.expect),
	});

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

	const out = await $`project-two | tee ${tg.output}`
		.env(result)
		.then(tg.File.expect);
	tg.assert((await out.text).includes("project 2"));
}

export async function testCacheHitUnchangedWorkspaceCrates() {
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
	const out = await $`cli | tee ${tg.output}`
		.env(secondResult)
		.then(tg.File.expect);
	tg.assert((await out.text).trim() === "Hello from a workspace!");
}

export async function testMultiVersionCacheHit() {
	const source = await tests.get("multi-version").then(tg.Directory.expect);
	const { second } = await assertCacheHit({
		source,
		modifyPath: "crate-b/src/main.rs",
		expectations: {
			crate_a: true,
			crate_b: false,
		},
	});
	const unexpected = second.filter(
		(s) => !s.cached && s.crate_name !== "crate_b",
	);
	tg.assert(
		unexpected.length === 0,
		`Expected all crates except crate_b to be cache hits, misses: ${unexpected.map((s) => s.crate_name).join(", ")}.`,
	);
}

export async function testCacheHitWithDepVars() {
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
}

export async function testCacheHitWithPreScript() {
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
}

export async function testSysLinkCache() {
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
}

/** Legacy fixture: workspace with a build script in a workspace member. */
export async function testWorkspaceBuildScript() {
	const result = await cargo.build({
		source: tests.get("workspace-build-script").then(tg.Directory.expect),
		proxy: true,
	});
	console.log("testWorkspaceBuildScript result", result.id);

	const out = await $`app | tee ${tg.output}`.env(result).then(tg.File.expect);
	tg.assert(
		(await out.text).includes("Built at:"),
		`unexpected output: ${await out.text}`,
	);
	return result;
}

/** Legacy fixture: cc-rs C-compile build script. */
export async function testCcRs() {
	const result = await cargo.build({
		source: tests.get("hello-cc-rs").then(tg.Directory.expect),
		proxy: true,
	});
	console.log("testCcRs result", result.id);

	const out = await $`hello-cc-rs | tee ${tg.output}`
		.env(result)
		.then(tg.File.expect);
	const text = await out.text;
	tg.assert(text.trim() === "10 + 32 = 42", `unexpected output: ${text}`);
}

/** Runner: build scripts execute inside a tangram sandbox via `host.runner`.
 *  Asserts cache stability — modifying main.rs (not the build script or its
 *  inputs) must keep the runner_complete entry for cc-rs a cache hit. */
export async function testRunnerBuildScript() {
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
}

/** Regression: NODE_PATH must reach build scripts unmangled. */
export async function testRunnerEnvPassthrough() {
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
}

/** Regression: tools at `$NODE_PATH/.bin/<tool>` (a npm/bun pattern) must be
 *  reachable from a build script via PATH, and symlinks inside that dir must
 *  resolve through the checkin. */
export async function testRunnerPathTools() {
	// Fake `node_modules` with a `.bin` symlink, mimicking npm/bun layout.
	const toolFile = tg.file("tool output from my-tool\n");
	const nodeModules = tg.directory({
		"my-tool-pkg": {
			"tool.sh": toolFile,
		},
		".bin": {
			"my-tool": tg.symlink("../my-tool-pkg/tool.sh"),
		},
	});

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
}

/** Regression: rustc cfg probes via RUSTC_WRAPPER must work from a build
 *  script (rustix/getrandom/etc. use `cargo:rustc-cfg=...` after probing). */
export async function testRunnerCfgProbe() {
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
}

/** Regression: runner sandbox lacks /usr/bin/env; std.wrap'd binaries with an
 *  explicit interpreter must still resolve via PATH. */
export async function testRunnerPathExec() {
	const host = await std.triple.host();
	const dashBin = await dash({ host })
		.then((d) => d.get("bin/dash"))
		.then(tg.File.expect);
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
		env: std.env.arg(toolDir, {}),
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
}

/** Build script in a workspace member reads a sibling workspace file via
 *  `CARGO_MANIFEST_DIR/..`. The runner sandbox must expose the workspace root,
 *  not only the per-crate manifest dir. */
export async function testRunnerWorkspaceRootAccess() {
	const source = await tests
		.get("workspace-root-access")
		.then(tg.Directory.expect);
	const result = await cargo.build({ source, proxy: true });
	console.log("testRunnerWorkspaceRootAccess result", result.id);

	const output = await $`app | tee ${tg.output}`
		.env(result)
		.then(tg.File.expect);
	const text = await output.text;
	tg.assert(
		text.includes("workspace-level shared configuration"),
		`expected output to include workspace config, got: ${text}`,
	);
}

/** Modifying a workspace member must not invalidate the runner cache for
 *  unrelated sibling crates. */
export async function testRunnerCacheHitWorkspace() {
	const source = await tests
		.get("workspace-runner-cache")
		.then(tg.Directory.expect);
	await assertCacheHit({
		source,
		modifyPath: "packages/app/src/main.rs",
		expectations: {
			lib: true,
		},
	});
}

export async function test() {
	await Promise.all([
		testProbe(),
		testWorkspace(),
		testCodegen(),
		testProcMacroDeps(),
		testWorkspaceMode2(),
		testHello(),
		testProcMacro(),
		testProcMacroWithDeps(),
		testCcRs(),
		testProxyCompiles(),
		testPkgconfig(),
		testOpenSSL(),
		testBindgen(),
		testBuildScriptEnvDep(),
		testBuildScriptFileDep(),
		testWorkspaceBuildScript(),
		testRunnerBuildScript(),
		testRunnerCfgProbe(),
		testRunnerEnvPassthrough(),
		testRunnerPathExec(),
		testRunnerWorkspaceRootAccess(),
		testRunnerCacheHitWorkspace(),
	]);
	return true;
}
