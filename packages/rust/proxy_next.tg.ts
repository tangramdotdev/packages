import * as std from "std" with { source: "../std" };
import { $ } from "std" with { source: "../std" };

import { cargo } from "./tangram.ts";

import cargoToml from "./tgrustc-next/Cargo.toml" with { type: "file" };
import cargoLock from "./tgrustc-next/Cargo.lock" with { type: "file" };
import src from "./tgrustc-next/src" with { type: "directory" };

import probeFixture from "./tgrustc-next/tests/probe" with { type: "directory" };
import tests from "./tests" with { type: "directory" };

/** Same layout trick as proxy.tg.ts: `../../std` from tgrustc-next's Cargo.toml resolves to the std Rust workspace. */
export const source = async () =>
	tg.directory({
		"rust/tgrustc-next": {
			"Cargo.toml": cargoToml,
			"Cargo.lock": cargoLock,
			src,
		},
		std: std.rustSource,
	});

export const proxyNext = async (...args: std.Args<cargo.Arg>) =>
	cargo.build(
		{
			source: source(),
			manifestSubdir: "rust/tgrustc-next",
			proxy: false,
			useCargoVendor: true,
		},
		...args,
	);

/** Phase-4: workspace with proc-macro crate + crates.io deps. */
export const testProcMacroDeps = async () => {
	const wrapper = await proxyNext();
	const source = await tests
		.get("hello-proc-macro-deps")
		.then(tg.Directory.expect);

	const result = await cargo.build({
		source,
		proxy: false,
		captureStderr: true,
		env: {
			RUSTC_WRAPPER: tg`${wrapper}/bin/tgrustc-next`,
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
	const wrapper = await proxyNext();
	const source = await tests.get("hello-codegen").then(tg.Directory.expect);

	const result = await cargo.build({
		source,
		proxy: false,
		env: {
			RUSTC_WRAPPER: tg`${wrapper}/bin/tgrustc-next`,
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
	const wrapper = await proxyNext();
	const source = await tests.get("hello-workspace").then(tg.Directory.expect);

	const result = await cargo.build({
		source,
		proxy: false,
		captureStderr: true,
		verbose: true,
		env: {
			RUSTC_WRAPPER: tg`${wrapper}/bin/tgrustc-next`,
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
	const wrapper = await proxyNext();
	const source = await tests.get("hello-workspace").then(tg.Directory.expect);

	const result = await cargo.build({
		source,
		proxy: false,
		captureStderr: true,
		verbose: true,
		env: {
			RUSTC_WRAPPER: tg`${wrapper}/bin/tgrustc-next`,
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

/** Phase-1 probe: build a tiny single-bin cargo project with tgrustc-next as RUSTC_WRAPPER. */
export const testProbe = async () => {
	const wrapper = await proxyNext();

	const result = await cargo.build({
		source: probeFixture,
		proxy: false,
		env: {
			RUSTC_WRAPPER: tg`${wrapper}/bin/tgrustc-next`,
		},
	});
	console.log("testProbe result", result.id);

	const out = await $`probe | tee ${tg.output}`
		.env(result)
		.then(tg.File.expect);
	const text = await out.text;
	tg.assert(
		text.trim() === "hi from tgrustc-next",
		`unexpected output: ${text}`,
	);
	return result;
};
