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
		testBootstrapEnvImageDockerMultipleUsers(),
		testBootstrapEnvImageDockerUsersWithDefault(),
		testBootstrapEnvImageDockerUsersWithSpecs(),
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
	const script = `echo "Hello, world!"`;
	const buildToolchain = await bootstrapBuildToolchain();
	const exe = await std.wrap(script, { buildToolchain, interpreter: shell });
	await exe.store();
	console.log("exe", exe.id);
	const imageFile = await image(exe, { buildToolchain });
	return imageFile;
};

export const testWrappedEntrypointWithEnv = async () => {
	const shell = tg.File.expect(await (await bootstrap.shell()).get("bin/dash"));
	const script = `echo "Hello, $NAME!"`;
	const buildToolchain = await bootstrapBuildToolchain();
	const env = { NAME: "Tangram" };
	const exe = await std.wrap(script, {
		buildToolchain,
		env: std.env.arg(env),
		interpreter: shell,
	});
	await exe.store();
	console.log("exe", exe.id);
	const imageFile = await image(exe, { buildToolchain });
	return imageFile;
};

export const testBasicRootfs = async () => {
	const utils = bootstrap.sdk.prepareBootstrapUtils();
	const rootFs = tg.directory(utils, {
		"hello.txt": tg.file`Hello, world!`,
	});
	const imageFile = await image(rootFs, {
		buildToolchain: await bootstrapBuildToolchain(),
		cmd: ["/bin/sh", "-c", "cat /hello.txt"],
	});

	return imageFile;
};

export const testBasicRootfsWithEnv = async () => {
	const utils = bootstrap.sdk.prepareBootstrapUtils();
	const rootFs = tg.directory(utils, {
		"hello.txt": tg.file`Hello, world!`,
	});
	const env = { NAME: "Tangram" };
	const imageFile = await image(rootFs, {
		buildToolchain: await bootstrapBuildToolchain(),
		cmd: ["/bin/sh", "-c", "cat /hello.txt && echo $NAME"],
		env,
	});

	return imageFile;
};

export const testBasicRootfsWithEnvAndEntrypoint = async () => {
	const utils = bootstrap.sdk.prepareBootstrapUtils();
	const rootFs = tg.directory(utils, {
		"hello.txt": tg.file`Hello, world!`,
	});
	const env = { NAME: "Tangram" };
	const imageFile = await image(rootFs, {
		buildToolchain: await bootstrapBuildToolchain(),
		cmd: ["-c", "cat /hello.txt && cat $NAME"],
		env,
		entrypoint: ["/bin/sh"],
	});

	return imageFile;
};

export const testBootstrapEnv = async () => {
	const utils = bootstrap.sdk.prepareBootstrapUtils();
	const buildToolchain = await bootstrapBuildToolchain();
	const bootstrapEnvArg = await std.env.arg(
		utils,
		{ NAME: "Tangram" },
		{ utils: false },
	);
	const bootstrapEnv = await std.wrap(await tg.build(gnuEnv).named("gnu env"), {
		buildToolchain,
		env: bootstrapEnvArg,
	});
	return tg.directory({ env: bootstrapEnv });
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

export const testBootstrapEnvImageDockerAlt = async () => {
	const bootstrapEnv = await testBootstrapEnv();
	const buildToolchain = await bootstrapBuildToolchain();
	const imageFile = await image("sh", {
		buildToolchain,
		env: bootstrapEnv,
	});
	return imageFile;
};

export const testBootstrapEnvImageDockerUser = async () => {
	const bootstrapEnv = await testBootstrapEnv();
	const buildToolchain = await bootstrapBuildToolchain();
	const imageFile = await image(bootstrapEnv, {
		buildToolchain,
		cmd: ["sh"],
		user: "ben",
	});
	return imageFile;
};

export const testBootstrapEnvImageDockerMultipleUsers = async () => {
	const bootstrapEnv = await testBootstrapEnv();
	const buildToolchain = await bootstrapBuildToolchain();
	const imageFile = await image(bootstrapEnv, {
		buildToolchain,
		cmd: ["sh"],
		users: ["postgres", "redis:redis:999:999", "app:app:1001:1001"],
	});
	return imageFile;
};

export const testBootstrapEnvImageDockerUsersWithDefault = async () => {
	const bootstrapEnv = await testBootstrapEnv();
	const buildToolchain = await bootstrapBuildToolchain();
	const imageFile = await image(bootstrapEnv, {
		buildToolchain,
		cmd: ["sh"],
		users: ["postgres", "redis:redis", "nginx"],
		user: "app", // This will be the default user AND create an additional user
	});
	return imageFile;
};

export const testBootstrapEnvImageDockerUsersWithSpecs = async () => {
	const bootstrapEnv = await testBootstrapEnv();
	const buildToolchain = await bootstrapBuildToolchain();
	const imageFile = await image(bootstrapEnv, {
		buildToolchain,
		cmd: ["sh"],
		users: [
			{ name: "postgres", uid: 999, gid: 999, shell: "/bin/sh" },
			{ name: "redis", uid: 998, group: "redis", gid: 998 },
			"nginx:nginx:997:997",
		],
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
	const detectedHost = std.triple.host();
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
	const basicEnv = await std.wrap(await tg.build(gnuEnv).named("gnu env"), {
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

export const testLabelsFeature = async () => {
	const bootstrapEnv = await testBootstrapEnv();
	const buildToolchain = await bootstrapBuildToolchain();
	const labels = {
		"org.opencontainers.image.title": "Test Image",
		"org.opencontainers.image.description": "A test image with labels",
		"org.opencontainers.image.version": "1.0.0",
		"com.example.custom": "custom-value",
	};
	const imageFile = await image(bootstrapEnv, {
		buildToolchain,
		cmd: ["sh"],
		labels,
	});
	return imageFile;
};
