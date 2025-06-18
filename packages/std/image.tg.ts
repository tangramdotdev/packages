import * as container from "./image/container.tg.ts";
import * as std from "./tangram.ts";
import { gnuEnv } from "./utils/coreutils.tg.ts";

export type Arg = string | tg.Template | tg.Artifact | ArgObject;

export type ArgObject = container.Arg;

/** Create an image file comprised of Tangram artifacts. */
export const image = async (...args: std.Args<Arg>): Promise<tg.File> => {
	return container.image(...args);
};

export default image;

import * as bootstrap from "./bootstrap.tg.ts";

export const test = async () => {
	const tests = [
		testWrappedEntrypoint(),
		testBasicRootfs(),
		testBootstrapEnvImageDocker(),
		testBootstrapEnvImageOci(),
	];
	await Promise.all(tests);
	return true;
};

export const bootstrapBuildToolchain = async () => {
	return await std.env.arg(bootstrap.sdk(), bootstrap.make.build(), {
		utils: false,
	});
};

export const testWrappedEntrypoint = async () => {
	const shell = tg.File.expect(await (await bootstrap.shell()).get("bin/dash"));
	const script = `echo "hello, world!"`;
	const buildToolchain = await bootstrapBuildToolchain();
	const exe = await std.wrap(script, { buildToolchain, interpreter: shell });
	const imageFile = await image(exe);
	return imageFile;
};

export const testBasicRootfs = async () => {
	// Test a container with a single file and a shell in it.
	const shell = bootstrap.shell();
	const utils = bootstrap.utils();
	const rootFs = tg.directory(shell, utils, {
		"hello.txt": tg.file`Hello, world!`,
	});
	const imageFile = await image(rootFs, {
		cmd: ["/bin/sh", "-c", "cat /hello.txt"],
	});

	return imageFile;
};

export const testBootstrapEnv = async () => {
	const utils = await bootstrap.utils();
	const buildToolchain = await bootstrapBuildToolchain();
	const bootstrapEnvArg = await std.env.arg(
		utils,
		{ NAME: "Tangram" },
		{ utils: false },
	);
	const bootstrapEnv = await std.wrap(gnuEnv(), {
		buildToolchain,
		env: bootstrapEnvArg,
	});
	return bootstrapEnv;
};

export const testBootstrapEnvImageDocker = async () => {
	const bootstrapEnv = await testBootstrapEnv();
	const buildToolchain = await bootstrapBuildToolchain();
	const imageFile = await image(bootstrapEnv, {
		buildToolchain,
		cmd: ["sh"],
	});
	return imageFile;
};

export const testBootstrapEnvImageOci = async () => {
	const basicEnv = await testBootstrapEnv();
	const buildToolchain = await bootstrapBuildToolchain();
	const imageFile = await image(basicEnv, {
		buildToolchain,
		cmd: ["sh"],
		format: "oci",
	});
	return imageFile;
};

export const testBasicEnv = async () => {
	const detectedHost = await std.triple.host();
	const host = bootstrap.toolchainTriple(detectedHost);
	const utils = await std.utils.env({
		host,
		env: bootstrap.sdk(),
	});
	const buildToolchain = await bootstrapBuildToolchain();
	const basicEnvArg = await std.env.arg(
		utils,
		{ NAME: "Tangram" },
		{ utils: false },
	);
	const basicEnv = await std.wrap(gnuEnv(), {
		buildToolchain,
		env: basicEnvArg,
	});
	return basicEnv;
};

export const testBasicEnvImageDocker = async () => {
	const basicEnv = await testBasicEnv();
	const buildToolchain = await bootstrapBuildToolchain();
	const imageFile = await image(basicEnv, {
		buildToolchain,
		cmd: ["bash"],
	});
	return imageFile;
};

export const testBasicEnvImageOci = async () => {
	const basicEnv = await testBasicEnv();
	const buildToolchain = await bootstrapBuildToolchain();
	const imageFile = await image(basicEnv, {
		buildToolchain,
		cmd: ["bash"],
		format: "oci",
	});
	return imageFile;
};
