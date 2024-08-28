import * as container from "./image/container.tg.ts";
import * as std from "./tangram.tg.ts";

export type Arg = string | tg.Template | tg.Artifact | ArgObject;

export type ArgObject = container.Arg;

/** Create an image file comprised of Tangram artifacts. */
export let image = tg.target(
	async (...args: std.Args<Arg>): Promise<tg.File> => {
		return container.image(...args);
	},
);

export default image;

import * as bootstrap from "./bootstrap.tg.ts";
export let test = tg.target(async () => {
	return testWrappedEntrypoint();
});

export let testWrappedEntrypoint = tg.target(async () => {
	let shell = tg.File.expect(await (await bootstrap.shell()).get("bin/dash"));
	let script = `echo "hello, world!"`;
	let exe = await std.wrap(script, { interpreter: shell });
	let imageFile = await image(exe);
	return imageFile;
});

export let testBasicRootfs = tg.target(async () => {
	// Test a container with a single file and a shell in it.
	let shell = bootstrap.shell();
	let utils = bootstrap.utils();
	let rootFs = tg.directory(shell, utils, {
		"hello.txt": tg.file("Hello, world!"),
	});
	let imageFile = await image(rootFs, {
		cmd: ["/bin/sh", "-c", "cat /hello.txt"],
	});

	return imageFile;
});

export let testOciBasicEnv = tg.target(async () => {
	let detectedHost = await std.triple.host();
	let host = bootstrap.toolchainTriple(detectedHost);
	let utils = await std.utils.env({ host, sdk: bootstrap.sdk.arg() });
	let basicEnv = await std.env(utils, { NAME: "Tangram" }, { utils: true });
	return basicEnv;
});

export let testBasicEnvImageDocker = tg.target(async () => {
	let basicEnv = await testOciBasicEnv();
	let imageFile = await image(basicEnv, {
		cmd: ["bash"],
	});
	return imageFile;
});

export let testBasicEnvImageOci = tg.target(async () => {
	let basicEnv = await testOciBasicEnv();
	let imageFile = await image(basicEnv, {
		cmd: ["bash"],
		format: "oci",
	});
	return imageFile;
});
