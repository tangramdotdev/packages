import * as container from "./image/container.tg.ts";
import * as std from "./tangram.ts";

export type Arg = string | tg.Template | tg.Artifact | ArgObject;

export type ArgObject = container.Arg;

/** Create an image file comprised of Tangram artifacts. */
export const image = tg.target(
	async (...args: std.Args<Arg>): Promise<tg.File> => {
		return container.image(...args);
	},
);

export default image;

import * as bootstrap from "./bootstrap.tg.ts";
export const test = tg.target(async () => {
	const tests = [
		testWrappedEntrypoint(),
		testBasicRootfs(),
		testBasicEnvImageDocker(),
		testBasicEnvImageOci(),
	];
	await Promise.all(tests);
	return true;
});

export const testWrappedEntrypoint = tg.target(async () => {
	const shell = tg.File.expect(await (await bootstrap.shell()).get("bin/dash"));
	const script = `echo "hello, world!"`;
	const exe = await std.wrap(script, { interpreter: shell });
	const imageFile = await image(exe);
	return imageFile;
});

export const testBasicRootfs = tg.target(async () => {
	// Test a container with a single file and a shell in it.
	const shell = bootstrap.shell();
	const utils = bootstrap.utils();
	const rootFs = tg.directory(shell, utils, {
		"hello.txt": tg.file("Hello, world!"),
	});
	const imageFile = await image(rootFs, {
		cmd: ["/bin/sh", "-c", "cat /hello.txt"],
	});

	return imageFile;
});

export const testOciBasicEnv = tg.target(async () => {
	const detectedHost = await std.triple.host();
	const host = bootstrap.toolchainTriple(detectedHost);
	const utils = await std.utils.env({ host, sdk: bootstrap.sdk.arg() });
	const basicEnv = await std.env(utils, { NAME: "Tangram" }, { utils: true });
	return basicEnv;
});

export const testBasicEnvImageDocker = tg.target(async () => {
	const basicEnv = await testOciBasicEnv();
	const imageFile = await image(basicEnv, {
		cmd: ["bash"],
	});
	return imageFile;
});

export const testBasicEnvImageOci = tg.target(async () => {
	const basicEnv = await testOciBasicEnv();
	const imageFile = await image(basicEnv, {
		cmd: ["bash"],
		format: "oci",
	});
	return imageFile;
});
