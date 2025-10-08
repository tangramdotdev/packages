import * as std from "std" with { local: "../std" };
import { $ } from "std" with { local: "../std" };

import { cargo, self, VERSION } from "./tangram.ts";

import cargoToml from "./tgrustc/Cargo.toml" with { type: "file" };
import cargoLock from "./tgrustc/Cargo.lock" with { type: "file" };
import src from "./tgrustc/src" with { type: "directory" };

export let source = async () => {
	return tg.directory({
		"Cargo.toml": cargoToml,
		"Cargo.lock": cargoLock,
		src,
	});
};

export type Arg = {
	buildToolchain: std.env.Arg;
	build?: string;
	host?: string;
	release?: boolean;
	source?: tg.Directory;
};

export const proxy = async (arg?: Arg) => {
	return cargo.build({
		source: source(),
		features: ["tracing"],
		proxy: false,
		useCargoVendor: true,
	});
};

export default proxy;

import pkgconf from "pkgconf" with { local: "../pkgconf" };
import openssl from "openssl" with { local: "../openssl" };
import tests from "./tests" with { type: "directory" };

export const testProxyCompiles = async () => {
	// Make sure the proxy compiles and runs.
	const version = await $`tgrustc rustc - --version | tee $OUTPUT`
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
		pre: "echo WATERMARK 1",
		proxy: true,
		env: {
			TGRUSTC_TRACING: "tgrustc=trace",
		},
	});
	console.log("helloWorld result", helloWorld.id);

	// Assert it produces the correct output.
	const helloOutput = await $`hello-world | tee $OUTPUT`
		.env(helloWorld)
		.then(tg.File.expect);
	const helloText = await helloOutput.text();
	tg.assert(helloText.trim() === "hello, proxy!\n128\nHello, build!");
	return true;
};

export const testPkgconfig = async () => {
	const host = await std.triple.host();
	const os = std.triple.os(host);
	const dylibExt = os === "darwin" ? "dylib" : "so";

	const source = tests.get("hello-c-dylib").then(tg.Directory.expect);

	// compile the dylib
	let externalLibDir = await $`
		mkdir -p $OUTPUT/lib
		mkdir -p $OUTPUT/include
		gcc -shared -fPIC ${source}/src/lib.c -o $OUTPUT/lib/libexternal.${dylibExt}
		cp ${source}/src/lib.h $OUTPUT/include/lib.h`
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
		pre: tg`set -x && echo WATERMARK 10`,
		env: std.env.arg(pkgconf(), externalLibDir, {
			TGRUSTC_TRACING: "tgrustc=trace",
		}),
		parallelJobs: 1,
		proxy: true,
		verbose: true,
	});
	console.log("result", rustOutput.id);

	// Assert it produces the correct output.
	const testOutput = await $`myapp | tee $OUTPUT`
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
		pre: "echo WATERMARK 10",
		env: std.env.arg(openssl(), pkgconf(), {
			TGRUSTC_TRACING: "tgrustc=trace",
		}),
		parallelJobs: 1,
		proxy: true,
		verbose: true,
	});
	console.log("helloOpenssl result", helloOpenssl.id);

	// Assert it produces the correct output.
	const opensslOutput = await $`hello-openssl | tee $OUTPUT`
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
	const workspaceOutput = await $`cli | tee $OUTPUT`
		.env(helloWorkspace)
		.then(tg.File.expect);
	const workspaceText = await workspaceOutput.text();
	tg.assert(workspaceText.trim() === "Hello from a workspace!");

	return true;
};

export const test = async () => {
	tg.assert(await testProxyCompiles());
	tg.assert(await testHello());
	tg.assert(await testPkgconfig());
	tg.assert(await testOpenSSL());
	tg.assert(await testWorkspace());
	return true;
};
