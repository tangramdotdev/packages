import * as container from "./image/container.tg.ts";
import * as std from "./tangram.ts";

export type Arg = string | tg.Template | tg.Artifact | ArgObject;

export type ArgObject = container.Arg;

/** Create an image file comprised of Tangram artifacts. */
export async function image(...args: tg.Args<Arg>): Promise<tg.File> {
	return container.image(...args);
}

export default image;

import * as bootstrap from "./bootstrap.tg.ts";

export async function bootstrapBuildToolchain() {
	return await std.env.compose(bootstrap.sdk(), bootstrap.make.build());
}

export async function testWrappedEntrypoint() {
	if (std.triple.os(std.triple.host()) !== "linux") {
		console.log("skipped image.tg.ts#testWrappedEntrypoint: requires Linux");
		return null;
	}
	const script = `echo "Hello, world!"`;
	const buildToolchain = await bootstrapBuildToolchain();
	const exe = await std.wrap(script, { buildToolchain });
	await exe.store();
	console.log("exe", exe.id);
	const imageFile = await image(exe, { buildToolchain });
	return imageFile;
}

export async function testWrappedEntrypointWithEnv() {
	if (std.triple.os(std.triple.host()) !== "linux") {
		console.log(
			"skipped image.tg.ts#testWrappedEntrypointWithEnv: requires Linux",
		);
		return null;
	}
	const script = `echo "Hello, $NAME!"`;
	const buildToolchain = await bootstrapBuildToolchain();
	const env = { NAME: "Tangram" };
	const exe = await std.wrap(script, {
		buildToolchain,
		env: std.env.arg(env),
	});
	await exe.store();
	console.log("exe", exe.id);
	const imageFile = await image(exe, { buildToolchain });
	return imageFile;
}

export async function testBasicRootfs() {
	if (std.triple.os(std.triple.host()) !== "linux") {
		console.log("skipped image.tg.ts#testBasicRootfs: requires Linux");
		return null;
	}
	const utils = bootstrap.sdk.prepareBootstrapUtils();
	const rootFs = tg.directory(utils, {
		"hello.txt": tg.file`Hello, world!`,
	});
	const imageFile = await image(rootFs, {
		buildToolchain: await bootstrapBuildToolchain(),
		cmd: ["/bin/sh", "-c", "cat /hello.txt"],
	});

	const { config } = await readImage(imageFile);
	assertEqual(config.Env ?? [], []);
	assertEqual(config.Entrypoint ?? [], []);

	assertEqual(await runImageCommand(imageFile), "Hello, world!");

	return imageFile;
}

/** Build a root file system with a layer larger than 2 GiB, which is larger than the runtime's maximum buffer size. */
async function largeLayerRootfs() {
	const utils = bootstrap.sdk.prepareBootstrapUtils();
	const large = await std.build`head -c 3221225472 /dev/zero > ${tg.output}`
		.named("large file")
		.then(tg.File.expect);
	return tg.directory(utils, { large });
}

export async function testLargeLayerDocker() {
	if (std.triple.os(std.triple.host()) !== "linux") {
		console.log("skipped image.tg.ts#testLargeLayerDocker: requires Linux");
		return null;
	}
	return await image(await largeLayerRootfs(), {
		buildToolchain: await bootstrapBuildToolchain(),
		cmd: ["/bin/sh", "-c", "wc -c /large"],
	});
}

export async function testLargeLayerOci() {
	if (std.triple.os(std.triple.host()) !== "linux") {
		console.log("skipped image.tg.ts#testLargeLayerOci: requires Linux");
		return null;
	}
	return await image(await largeLayerRootfs(), {
		buildToolchain: await bootstrapBuildToolchain(),
		cmd: ["/bin/sh", "-c", "wc -c /large"],
		format: "oci",
	});
}

export async function testBasicRootfsWithEnv() {
	if (std.triple.os(std.triple.host()) !== "linux") {
		console.log("skipped image.tg.ts#testBasicRootfsWithEnv: requires Linux");
		return null;
	}
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

	const { config } = await readImage(imageFile);
	assertEqual(config.Env ?? [], ["NAME=Tangram"]);
	assertEqual(config.Entrypoint ?? [], []);

	assertEqual(await runImageCommand(imageFile), "Hello, world!Tangram\n");

	assertEqual(
		await runImageCommand(imageFile, { NAME: "Runtime" }),
		"Hello, world!Runtime\n",
	);

	return imageFile;
}

export async function testBasicRootfsWithEnvAndEntrypoint() {
	if (std.triple.os(std.triple.host()) !== "linux") {
		console.log(
			"skipped image.tg.ts#testBasicRootfsWithEnvAndEntrypoint: requires Linux",
		);
		return null;
	}
	const utils = bootstrap.sdk.prepareBootstrapUtils();
	const rootFs = tg.directory(utils, {
		"hello.txt": tg.file`Hello, world!`,
	});
	const env = { NAME: "Tangram" };
	const imageFile = await image(rootFs, {
		buildToolchain: await bootstrapBuildToolchain(),
		cmd: ["-c", "cat /hello.txt && echo $NAME"],
		env,
		entrypoint: ["/bin/sh"],
	});

	const { config } = await readImage(imageFile);
	assertEqual(config.Env ?? [], ["NAME=Tangram"]);
	assertEqual(config.Entrypoint ?? [], ["/bin/sh"]);

	assertEqual(await runImageCommand(imageFile), "Hello, world!Tangram\n");

	assertEqual(
		await runImageCommand(imageFile, { NAME: "Runtime" }),
		"Hello, world!Runtime\n",
	);

	return imageFile;
}

export async function testArtifactEnvWithEntrypoint() {
	if (std.triple.os(std.triple.host()) !== "linux") {
		console.log(
			"skipped image.tg.ts#testArtifactEnvWithEntrypoint: requires Linux",
		);
		return null;
	}
	const utils = bootstrap.sdk.prepareBootstrapUtils();
	const greeting = tg.file`Hello, world!`;
	const env = { GREETING: tg`${greeting}`, NAME: "Tangram" };
	const imageFile = await image(utils, {
		buildToolchain: await bootstrapBuildToolchain(),
		cmd: ["-c", "cat $GREETING && echo $NAME"],
		env,
		entrypoint: ["/bin/sh"],
	});

	const { config } = await readImage(imageFile);
	assertEqual(config.Env ?? [], ["NAME=Tangram"]);
	assertEqual(config.Entrypoint ?? [], ["/entrypoint", "/bin/sh"]);
	assertEqual(await runImageCommand(imageFile), "Hello, world!Tangram\n");
	assertEqual(
		await runImageCommand(imageFile, { NAME: "Runtime" }),
		"Hello, world!Runtime\n",
	);

	return imageFile;
}

export async function testBootstrapEnv() {
	const utils = bootstrap.sdk.prepareBootstrapUtils();
	const buildToolchain = await bootstrapBuildToolchain();
	const bootstrapEnvArg = await std.env.compose(utils, { NAME: "Tangram" });
	const bootstrapEnv = await std.wrap(
		await tg.build(std.buildGnuEnv).named("gnu env"),
		{
			buildToolchain,
			env: bootstrapEnvArg,
		},
	);
	return tg.directory({ env: bootstrapEnv });
}

export async function testBootstrapEnvImageDocker() {
	if (std.triple.os(std.triple.host()) !== "linux") {
		console.log(
			"skipped image.tg.ts#testBootstrapEnvImageDocker: requires Linux",
		);
		return null;
	}
	const bootstrapEnv = await testBootstrapEnv();
	const buildToolchain = await bootstrapBuildToolchain();
	const imageFile = await image(bootstrapEnv, {
		buildToolchain,
		cmd: ["sh", "-c", 'printf "%s" "$NAME"'],
		entrypoint: ["/env"],
	});
	const { config } = await readImage(imageFile);
	assertEqual(config.Entrypoint, ["/env"]);
	assertEqual(await runImageCommand(imageFile), "Tangram");

	return imageFile;
}

export async function testBootstrapEnvImageDockerAlt() {
	if (std.triple.os(std.triple.host()) !== "linux") {
		console.log(
			"skipped image.tg.ts#testBootstrapEnvImageDockerAlt: requires Linux",
		);
		return null;
	}
	const bootstrapEnv = await testBootstrapEnv();
	const buildToolchain = await bootstrapBuildToolchain();
	const imageFile = await image("sh", {
		buildToolchain,
		env: bootstrapEnv,
	});
	return imageFile;
}

export async function testBootstrapEnvImageDockerUser() {
	if (std.triple.os(std.triple.host()) !== "linux") {
		console.log(
			"skipped image.tg.ts#testBootstrapEnvImageDockerUser: requires Linux",
		);
		return null;
	}
	const bootstrapEnv = await testBootstrapEnv();
	const buildToolchain = await bootstrapBuildToolchain();
	const imageFile = await image(bootstrapEnv, {
		buildToolchain,
		cmd: ["sh"],
		user: "ben",
	});
	return imageFile;
}

export async function testBootstrapEnvImageDockerMultipleUsers() {
	if (std.triple.os(std.triple.host()) !== "linux") {
		console.log(
			"skipped image.tg.ts#testBootstrapEnvImageDockerMultipleUsers: requires Linux",
		);
		return null;
	}
	const bootstrapEnv = await testBootstrapEnv();
	const buildToolchain = await bootstrapBuildToolchain();
	const imageFile = await image(bootstrapEnv, {
		buildToolchain,
		cmd: ["sh"],
		users: ["postgres", "redis:redis:999:999", "app:app:1001:1001"],
	});
	return imageFile;
}

export async function testBootstrapEnvImageDockerUsersWithDefault() {
	if (std.triple.os(std.triple.host()) !== "linux") {
		console.log(
			"skipped image.tg.ts#testBootstrapEnvImageDockerUsersWithDefault: requires Linux",
		);
		return null;
	}
	const bootstrapEnv = await testBootstrapEnv();
	const buildToolchain = await bootstrapBuildToolchain();
	const imageFile = await image(bootstrapEnv, {
		buildToolchain,
		cmd: ["sh"],
		users: ["postgres", "redis:redis", "nginx"],
		user: "app", // This will be the default user AND create an additional user
	});
	return imageFile;
}

export async function testBootstrapEnvImageDockerUsersWithSpecs() {
	if (std.triple.os(std.triple.host()) !== "linux") {
		console.log(
			"skipped image.tg.ts#testBootstrapEnvImageDockerUsersWithSpecs: requires Linux",
		);
		return null;
	}
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
}

export async function testBootstrapEnvImageOci() {
	if (std.triple.os(std.triple.host()) !== "linux") {
		console.log("skipped image.tg.ts#testBootstrapEnvImageOci: requires Linux");
		return null;
	}
	const basicEnv = await testBootstrapEnv();
	const buildToolchain = await bootstrapBuildToolchain();
	const imageFile = await image(basicEnv, {
		buildToolchain,
		cmd: ["sh"],
		format: "oci",
	});
	return imageFile;
}

export async function testBasicEnv() {
	const detectedHost = std.triple.host();
	const host = bootstrap.toolchainTriple(detectedHost);
	const utils = await std.utils.env({
		host,
		env: bootstrap.sdk(),
	});
	const buildToolchain = await bootstrapBuildToolchain();
	const basicEnvArg = await std.env.compose(utils, { NAME: "Tangram" });
	const basicEnv = await std.wrap(
		await tg.build(std.buildGnuEnv).named("gnu env"),
		{
			buildToolchain,
			env: basicEnvArg,
		},
	);
	return basicEnv;
}

export async function testBasicEnvImageDocker() {
	if (std.triple.os(std.triple.host()) !== "linux") {
		console.log("skipped image.tg.ts#testBasicEnvImageDocker: requires Linux");
		return null;
	}
	const basicEnv = await testBasicEnv();
	const buildToolchain = await bootstrapBuildToolchain();
	const imageFile = await image(basicEnv, {
		buildToolchain,
		cmd: ["bash"],
	});
	return imageFile;
}

export async function testBasicEnvImageOci() {
	if (std.triple.os(std.triple.host()) !== "linux") {
		console.log("skipped image.tg.ts#testBasicEnvImageOci: requires Linux");
		return null;
	}
	const basicEnv = await testBasicEnv();
	const buildToolchain = await bootstrapBuildToolchain();
	const imageFile = await image(basicEnv, {
		buildToolchain,
		cmd: ["bash"],
		format: "oci",
	});
	return imageFile;
}

export async function testLabelsFeature() {
	if (std.triple.os(std.triple.host()) !== "linux") {
		console.log("skipped image.tg.ts#testLabelsFeature: requires Linux");
		return null;
	}
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
}

export async function testVolumesFeature() {
	if (std.triple.os(std.triple.host()) !== "linux") {
		console.log("skipped image.tg.ts#testVolumesFeature: requires Linux");
		return null;
	}
	const bootstrapEnv = await testBootstrapEnv();
	const buildToolchain = await bootstrapBuildToolchain();
	const imageFile = await image(bootstrapEnv, {
		buildToolchain,
		cmd: ["sh"],
		volumes: ["/data", "/var/lib/example"],
	});
	return imageFile;
}

export async function testLiteralEnvConfiguration() {
	for (const format of ["docker", "oci"] as const) {
		const imageFile = await image(tg.directory(), {
			env: Object.fromEntries([
				["Z", tg.Mutation.set(tg`last=value`)],
				["EMPTY", ""],
				["COUNT", 2],
				["ENABLED", true],
			]),
			format,
			system: "x86_64-linux",
		});
		const { config } = await readImage(imageFile, format);
		assertEqual(config.Env, ["COUNT=2", "EMPTY=", "ENABLED=1", "Z=last=value"]);
		assertEqual(config.Entrypoint, []);
	}

	return true;
}

export async function testWrappedEntrypointEnvOverride() {
	if (std.triple.os(std.triple.host()) !== "linux") {
		console.log(
			"skipped image.tg.ts#testWrappedEntrypointEnvOverride: requires Linux",
		);
		return null;
	}
	const buildToolchain = await bootstrapBuildToolchain();
	const entrypoint = await std.wrap(await tg.build(std.buildGnuEnv), {
		buildToolchain,
		env: { GREETING: tg.file`hello`, NAME: "old" },
	});
	const imageFile = await image(bootstrap.sdk.prepareBootstrapUtils(), {
		buildToolchain,
		cmd: ["/bin/sh", "-c", 'printf "%s:" "$NAME"; cat "$GREETING"'],
		entrypoint,
		env: { NAME: "image" },
	});
	const { config } = await readImage(imageFile);
	assertEqual(config.Env, ["NAME=image"]);
	assertEqual(config.Entrypoint, ["/entrypoint"]);
	assertEqual(await runImageCommand(imageFile), "image:hello");
	assertEqual(
		await runImageCommand(imageFile, { NAME: "runtime" }),
		"runtime:hello",
	);

	return imageFile;
}

export async function testEnvMutations() {
	if (std.triple.os(std.triple.host()) !== "linux") {
		console.log("skipped image.tg.ts#testEnvMutations: requires Linux");
		return null;
	}
	const imageFile = await image(bootstrap.sdk.prepareBootstrapUtils(), {
		buildToolchain: await bootstrapBuildToolchain(),
		cmd: ["/bin/sh", "-c", 'printf "%s|%s|%s" "$APPEND" "$DEFAULT" "$EMPTY"'],
		env: {
			APPEND: tg.Mutation.suffix("tail", ":"),
			DEFAULT: tg.Mutation.setIfUnset("fallback"),
			EMPTY: "",
		},
	});
	const { config } = await readImage(imageFile);
	assertEqual(config.Env, ["EMPTY="]);
	assertEqual(config.Entrypoint, ["/entrypoint"]);
	assertEqual(await runImageCommand(imageFile), "tail|fallback|");
	assertEqual(
		await runImageCommand(imageFile, { APPEND: "head", DEFAULT: "runtime" }),
		"head:tail|runtime|",
	);

	return imageFile;
}

function assertEqual(actual: unknown, expected: unknown) {
	tg.assert(
		JSON.stringify(actual) === JSON.stringify(expected),
		`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
	);
}

async function readImage(
	imageFile: tg.File,
	format: container.ImageFormat = "docker",
) {
	const archive = await tg
		.extract(await imageFile.contents)
		.then(tg.Directory.expect);
	const readJson = async (path: string) => {
		const file = await archive.get(path).then(tg.File.expect);
		return tg.encoding.json.decode(await file.text);
	};
	let configPath: string;
	let layerPaths: Array<string>;
	if (format === "docker") {
		const manifest = (await readJson("manifest.json")) as Array<{
			Config: string;
			Layers: Array<string>;
		}>;
		tg.assert(manifest.length === 1);
		configPath = manifest[0]!.Config;
		layerPaths = manifest[0]!.Layers;
	} else {
		const blobPath = (digest: string) => `blobs/${digest.replace(":", "/")}`;
		const index = (await readJson("index.json")) as {
			manifests: Array<{ digest: string }>;
		};
		tg.assert(index.manifests.length === 1);
		const manifest = (await readJson(blobPath(index.manifests[0]!.digest))) as {
			config: { digest: string };
			layers: Array<{ digest: string }>;
		};
		configPath = blobPath(manifest.config.digest);
		layerPaths = manifest.layers.map((layer) => blobPath(layer.digest));
	}
	const imageConfig = (await readJson(configPath)) as container.ImageConfigV1;
	tg.assert(imageConfig.config !== undefined);
	const layers = await Promise.all(
		layerPaths.map((path) => archive.get(path).then(tg.File.expect)),
	);

	return { config: imageConfig.config, layers };
}

/** Run the image command in its root filesystem with the configured environment. */
async function runImageCommand(
	imageFile: tg.File,
	overrides: Record<string, string> = {},
) {
	const { config, layers } = await readImage(imageFile);
	const env: Record<string, string> = { PATH: "/bin:/usr/bin" };
	for (const entry of config.Env ?? []) {
		const separator = entry.indexOf("=");
		tg.assert(separator > 0);
		env[entry.slice(0, separator)] = entry.slice(separator + 1);
	}
	const command = [...(config.Entrypoint ?? []), ...(config.Cmd ?? [])];
	const utils = await bootstrap.sdk.prepareBootstrapUtils();

	// Extract the layers directly so that checking in the root filesystem does not consume its bundled store.
	const extract = await tg.Template.join(
		"\n",
		...layers.map((layer) => tg`${utils}/bin/tar -xf ${layer} -C rootfs`),
	);
	const script = tg`
		cd "$TMPDIR"
		${utils}/bin/mkdir -p rootfs/proc
		${extract}
		${utils}/bin/unshare -Ur -m ${utils}/bin/sh -ec '
			"$1/bin/mount" --bind /proc rootfs/proc
			utils="$1"
			shift
			exec "$utils/bin/chroot" rootfs "$@"
		' -- ${utils} "$@" > ${tg.output}
	`;
	const output = await tg
		.build({
			args: ["-ec", script, "--", ...command],
			env: { ...env, ...overrides },
			executable: "/bin/sh",
			host: std.triple.host(),
		})
		.then(tg.File.expect);

	return await output.text;
}
