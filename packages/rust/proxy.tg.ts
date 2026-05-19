import * as std from "std" with { source: "../std" };
import { $ } from "std" with { source: "../std" };

import { cargo, rustTriple, self } from "./tangram.ts";

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

export const test = async () => {
	await Promise.all([
		testProbe(),
		testWorkspace(),
		testCodegen(),
		testProcMacroDeps(),
		testWorkspaceMode2(),
	]);
	return true;
};
