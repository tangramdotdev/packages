import * as std from "std" with { path: "../std" };
import { $ } from "std" with { path: "../std" };

import { cargo, toolchain, VERSION } from "./tangram.ts";

import cargoToml from "./proxy/Cargo.toml" with { type: "file" };
import cargoLock from "./proxy/Cargo.lock" with { type: "file" };
import src from "./proxy/src" with { type: "directory" };

export let source = tg.target(async () => {
	return tg.directory({
		"Cargo.toml": cargoToml,
		"Cargo.lock": cargoLock,
		src,
	});
});

export type Arg = {
	buildToolchain: std.env.Arg;
	build?: string;
	host?: string;
	release?: boolean;
	source?: tg.Directory;
};

export const proxy = tg.target(async (arg?: Arg) => {
	return cargo.build({
		source: source(),
		features: ["tracing"],
		proxy: false,
		useCargoVendor: true,
	});
});

export default proxy;

import pkgconfig from "pkgconfig" with { path: "../pkgconfig" };
import openssl from "openssl" with { path: "../openssl" };
import tests from "./tests" with { type: "directory" };
export const test = tg.target(async () => {
	// Make sure the proxy compiles and runs.
	const version = await $`tangram_rustc_proxy rustc - --version | tee $OUTPUT`
		.env(proxy(), toolchain())
		.then(tg.File.expect);
	const versionText = await version.text();
	tg.assert(versionText.trim().includes(VERSION));

	// Build the basic proxy test.
	const helloWorld = await cargo.build({
		source: tests.get("hello-world").then(tg.Directory.expect),
		pre: "echo WATERMARK 1",
		proxy: true,
		env: {
			TANGRAM_RUSTC_TRACING: "tangram=trace",
		},
	});
	console.log("helloWorld result", await helloWorld.id());

	// Assert it produces the correct output.
	const helloOutput = await $`hello-world | tee $OUTPUT`
		.env(helloWorld)
		.then(tg.File.expect);
	const helloText = await helloOutput.text();
	tg.assert(helloText.trim() === "hello, proxy!\n128\nHello, build!");

	// Build the openssl proxy test.
	const helloOpenssl = await cargo.build({
		source: tests.get("hello-openssl").then(tg.Directory.expect),
		env: std.env.arg(openssl(), pkgconfig(), {
			TANGRAM_RUSTC_TRACING: "tangram=trace",
		}),
		proxy: true,
	});
	console.log("helloOpenssl result", await helloWorld.id());

	// Assert it produces the correct output.
	const opensslOutput = await $`hello-openssl | tee $OUTPUT`
		.env(helloOpenssl)
		.then(tg.File.expect);
	const opensslText = await opensslOutput.text();
	tg.assert(
		opensslText.trim() === "Hello, from a crate that links against libssl!",
	);

	// Build the workspace test.
	const helloWorkspace = await cargo.build({
		source: tests.get("hello-workspace").then(tg.Directory.expect),
		proxy: true,
		env: {
			TANGRAM_RUSTC_TRACING: "tangram=trace",
			TANGRAM_STRIP_PROXY_TRACING: "tangram=trace",
		},
	});
	console.log("helloWorkspace result", await helloWorkspace.id());

	// Assert it produces the correct output.
	const workspaceOutput = await $`cli | tee $OUTPUT`
		.env(helloWorkspace)
		.then(tg.File.expect);
	const workspaceText = await workspaceOutput.text();
	tg.assert(workspaceText.trim() === "Hello from a workspace!");

	return true;
});
