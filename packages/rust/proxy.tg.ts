import * as std from "std" with { source: "../std" };
import { $ } from "std" with { source: "../std" };
import { libclang } from "llvm" with { source: "../llvm" };
import openssl from "openssl" with { source: "../openssl.tg.ts" };
import pkgconf from "pkgconf" with { source: "../pkgconf.tg.ts" };

import { cargo, rustTriple, self, VERSION } from "./tangram.ts";

import cargoToml from "./tgrustc/Cargo.toml" with { type: "file" };
import cargoLock from "./tgrustc/Cargo.lock" with { type: "file" };
import src from "./tgrustc/src" with { type: "directory" };

import probeFixture from "./tgrustc/tests/probe" with { type: "directory" };
import tests from "./tests" with { type: "directory" };

/** `../../std` from tgrustc's Cargo.toml resolves to the std Rust workspace. */
export const source = async () =>
	tg.directory({
		"rust/tgrustc": {
			"Cargo.toml": cargoToml,
			"Cargo.lock": cargoLock,
			src,
		},
		std: std.rustSource,
	});

export const proxy = async (...args: std.Args<cargo.Arg>) =>
	cargo.build(
		{
			source: source(),
			manifestSubdir: "rust/tgrustc",
			proxy: false,
			profile: "dev",
			useCargoVendor: true,
		},
		...args,
	);

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
export const runProcMacroDeps = async () => {
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
};

/** Phase-4: workspace with proc-macro crate + crates.io deps. */
export const testProcMacroDeps = async () => {
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
};

/** Phase-3: single crate with build.rs that writes generated.rs into OUT_DIR. */
export const testCodegen = async () => {
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
};

/** Phase-5: hello-workspace with proxy + passthrough. Workspace members compile via passthrough on host rustc; vendored deps go through tangram sandbox processes. */
export const testWorkspaceMode2 = async () => {
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
};

/** Phase-2: workspace with cli + greeting lib. Exercises --extern and -L. */
export const testWorkspace = async () => {
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
};

/** Phase-1 probe: build a tiny single-bin cargo project with tgrustc as RUSTC_WRAPPER. */
export const testProbe = async () => {
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
};

/** Legacy fixture: hello-world with build.rs, OUT_DIR, include_bytes!, itoa vendored. */
export const testHello = async () => {
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
};

/** Legacy fixture: single proc-macro crate (no external deps). */
export const testProcMacro = async () => {
	const result = await cargo.build({
		source: tests.get("hello-proc-macro").then(tg.Directory.expect),
		proxy: true,
	});
	console.log("testProcMacro result", result.id);

	const out = await $`app | tee ${tg.output}`.env(result).then(tg.File.expect);
	const text = await out.text;
	tg.assert(text.trim() === "Hello from Greeter!", `unexpected output: ${text}`);
};

/** Legacy fixture: same as testProcMacroDeps but via the proxy=true flow. */
export const testProcMacroWithDeps = async () => {
	const result = await cargo.build({
		source: tests.get("hello-proc-macro-deps").then(tg.Directory.expect),
		proxy: true,
	});
	console.log("testProcMacroWithDeps result", result.id);

	const out = await $`app | tee ${tg.output}`.env(result).then(tg.File.expect);
	const text = await out.text;
	tg.assert(text.trim() === "Hello from Greeter!", `unexpected output: ${text}`);
};

/** Legacy smoke test: invoke the wrapper directly to print rustc --version. */
export const testProxyCompiles = async () => {
	const version = await $`tgrustc rustc - --version | tee ${tg.output}`
		.env(proxy())
		.env(self())
		.then(tg.File.expect);
	const versionText = await version.text;
	tg.assert(
		versionText.trim().includes(VERSION),
		`unexpected version output: ${versionText}`,
	);
};

/** Legacy fixture: links against a custom pkgconfig-provided dylib. */
export const testPkgconfig = async () => {
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

	const out = await $`myapp | tee ${tg.output}`.env(result).then(tg.File.expect);
	const text = await out.text;
	tg.assert(
		text.trim() === "You passed the number: 42",
		`unexpected output: ${text}`,
	);
};

/** Legacy fixture: links against system openssl via openssl-sys. */
export const testOpenSSL = async () => {
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
};

/** Legacy fixture: bindgen requires libclang from LLVM. */
export const testBindgen = async () => {
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
};

/** Legacy fixture: build script reads MY_BUILD_VAR; different values bust cache. */
export const testBuildScriptEnvDep = async () => {
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
};

/** Legacy fixture: build script reads a file from the source tree. */
export const testBuildScriptFileDep = async () => {
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
};

/** Legacy fixture: workspace with a build script in a workspace member. */
export const testWorkspaceBuildScript = async () => {
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
};

/** Legacy fixture: cc-rs C-compile build script. */
export const testCcRs = async () => {
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
};

export const test = async () => {
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
	]);
	return true;
};
