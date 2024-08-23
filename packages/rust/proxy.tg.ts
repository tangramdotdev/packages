import * as std from "tg:std" with { path: "../std" };
import { $ } from "tg:std" with { path: "../std" };

import { cargo, toolchain, VERSION } from "./tangram.tg.ts";

export type Arg = {
	buildToolchain: std.env.Arg;
	build?: string;
	host?: string;
	release?: boolean;
	source?: tg.Directory;
};

export let proxy = tg.target(async (arg?: Arg) => {
	return await tg.directory({
		["bin/tangram_rustc"]: std.rustcProxy(arg),
	});
});

export default proxy;

// import * as pkgconfig from "tg:pkg-config" with { path: "../pkgconfig" };
// import * as openssl from "tg:openssl" with { path: "../openssl" };
import tests from "./tests" with { type: "directory" };
export let test = tg.target(async () => {
	// Make sure the proxy compiles and runs.
	let version = await $`tangram_rustc rustc - --version | tee $OUTPUT`
		.env(proxy(), toolchain())
		.then(tg.File.expect);
	let versionText = await version.text();
	tg.assert(versionText.trim().includes(VERSION));

	// Build the basic proxy test.
	let helloWorld = await cargo.build({
		source: tests.get("hello-world"),
		pre: "echo WATERMARK 1",
		proxy: true,
		env: {
			TANGRAM_RUSTC_TRACING: "tangram=trace",
		},
	});
	console.log("helloWorld result", await helloWorld.id());

	// Assert it produces the correct output.
	let helloOutput = await $`hello-world | tee $OUTPUT`
		.env(helloWorld)
		.then(tg.File.expect);
	let helloText = await helloOutput.text();
	tg.assert(helloText.trim() === "hello, proxy!\n128\nHello, build!");

	// // Build the openssl proxy test.
	// let helloOpenssl = await cargo.build({
	// 	source: tests.get("hello-openssl"),
	// 	env: std.env.arg(await openssl.build(), pkgconfig.build(), {
	// 		TANGRAM_RUSTC_TRACING: "tangram=trace",
	// 	}),
	// 	proxy: true,
	// });
	// console.log("helloOpenssl result", await helloWorld.id());

	// // Assert it produces the correct output.
	// let opensslOutput = await $`hello-openssl | tee $OUTPUT`
	// 	.env(helloOpenssl)
	// 	.then(tg.File.expect);
	// let opensslText = await opensslOutput.text();
	// tg.assert(
	// 	opensslText.trim() === "Hello, from a crate that links against libssl!",
	// );

	// Build the workspace test.
	let helloWorkspace = await cargo.build({
		source: tests.get("hello-workspace"),
		proxy: true,
		env: {
			TANGRAM_RUSTC_TRACING: "tangram=trace",
		},
	});
	console.log("helloWorkspace result", await helloWorkspace.id());

	// Assert it produces the correct output.
	let workspaceOutput = await $`cli | tee $OUTPUT`
		.env(helloWorkspace)
		.then(tg.File.expect);
	let workspaceText = await workspaceOutput.text();
	tg.assert(workspaceText.trim() === "Hello from a workspace!");

	return true;
});
