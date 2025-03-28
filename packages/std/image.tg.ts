import * as container from "./image/container.tg.ts";
import * as std from "./tangram.ts";

export type Arg = string | tg.Template | tg.Artifact | ArgObject;

export type ArgObject = container.Arg;

/** Create an image file comprised of Tangram artifacts. */
export const image = tg.command(
	async (...args: std.Args<Arg>): Promise<tg.File> => {
		return container.image(...args);
	},
);

export default image;

import * as bootstrap from "./bootstrap.tg.ts";

export const test = tg.command(async () => {
	const tests = [
		testWrappedEntrypoint(),
		testBasicRootfs(),
		testBootstrapEnvImageDocker(),
		testBootstrapEnvImageOci(),
	];
	await Promise.all(tests);
	return true;
});

export const testWrappedEntrypoint = tg.command(async () => {
	const shell = tg.File.expect(await (await bootstrap.shell()).get("bin/dash"));
	const script = `echo "hello, world!"`;
	const exe = await std.wrap(script, { interpreter: shell });
	const imageFile = await image(exe);
	return imageFile;
});

export const testBasicRootfs = tg.command(async () => {
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

export const testBootstrapEnv = tg.command(async () => {
	const utils = await bootstrap.utils();
	const basicEnv = await std.env(utils, { NAME: "Tangram" }, { utils: false });
	return basicEnv;
});

export const testBootstrapEnvImageDocker = tg.command(async () => {
	const basicEnv = await testBootstrapEnv();
	const buildToolchain = await std.env.arg(
		bootstrap.sdk(),
		bootstrap.make.build(),
	);
	const imageFile = await image(basicEnv, {
		buildToolchain,
		cmd: ["sh"],
	});
	return imageFile;
});

export const testBootstrapEnvImageOci = tg.command(async () => {
	const basicEnv = await testBootstrapEnv();
	const buildToolchain = await std.env.arg(
		bootstrap.sdk(),
		bootstrap.make.build(),
	);
	const imageFile = await image(basicEnv, {
		buildToolchain,
		cmd: ["sh"],
		format: "oci",
	});
	return imageFile;
});

export const testBasicEnv = tg.command(async () => {
	const detectedHost = await std.triple.host();
	const host = bootstrap.toolchainTriple(detectedHost);
	const utils = await std.utils.env({ host, sdk: false, env: bootstrap.sdk() });
	const basicEnv = await std.env(utils, { NAME: "Tangram" }, { utils: false });
	return basicEnv;
});

export const testBasicEnvImageDocker = tg.command(async () => {
	const basicEnv = await testBasicEnv();
	const buildToolchain = await std.env.arg(
		bootstrap.sdk(),
		bootstrap.make.build(),
	);
	const imageFile = await image(basicEnv, {
		buildToolchain,
		cmd: ["bash"],
	});
	return imageFile;
});

export const testBasicEnvImageOci = tg.command(async () => {
	const basicEnv = await testBasicEnv();
	const buildToolchain = await std.env.arg(
		bootstrap.sdk(),
		bootstrap.make.build(),
	);
	const imageFile = await image(basicEnv, {
		buildToolchain,
		cmd: ["bash"],
		format: "oci",
	});
	return imageFile;
});
