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
	return true;
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
	return true;
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
	return true;
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

	return true;
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
	return true;
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
	return true;
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
	return true;
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

	return true;
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
	return true;
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
	return true;
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
	return true;
};

export const testProcMacroCross = async () => {
	// Cross-compile a proc-macro workspace.
	// Proc macros must compile for the host, while the app compiles for the target.
	const hostTriple = await std.triple.host();
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

	return true;
};

export const testBindgen = async () => {
	// Build a project with a build script that uses bindgen.
	// Bindgen requires libclang, so we need to provide LLVM.
	// Import llvm lazily to avoid circular dependency: rust -> llvm -> python -> rust
	const { libclang } = await import("../llvm");
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
	return true;
};

export const test = async () => {
	tg.assert(await testProxyCompiles());
	tg.assert(await testHello());
	tg.assert(await testPkgconfig());
	tg.assert(await testOpenSSL());
	tg.assert(await testWorkspace());
	tg.assert(await testParallelDeps());
	tg.assert(await testProcMacro());
	tg.assert(await testBuildScriptCodegen());
	tg.assert(await testBuildScriptEnvDep());
	tg.assert(await testBuildScriptFileDep());
	tg.assert(await testCcRs());
	tg.assert(await testProcMacroWithDeps());
	return true;
};
