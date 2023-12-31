import * as docker from "./container/docker.tg.ts";
import * as oci from "./container/oci.tg.ts";
import * as std from "./tangram.tg.ts";
export { oci, docker };

export type Arg = string | tg.Template | tg.Artifact | ArgObject;

type ExecutableArg = {
	executable: std.wrap.Arg;

	rootFileSystem?: tg.Directory;
};

type RootFsArg = {
	rootFileSystem: tg.Directory;

	/** This is the equivalent of the ENTRYPOINT instruction in  Dockerfile. */
	entrypoint?: Array<string>;

	/** This is the equivalent of the CMD instruction in a dockerfile. */
	cmd?: Array<string>;
};

export type ArgObject = (ExecutableArg | RootFsArg) & {
	/** The system the container is intended to run on. */
	system?: std.Triple.Arg;

	/** The container image format to build. Many platforms support the OCI container image format, but Docker and Moby currently only support the Docker image format. */
	format?: ImageFormat;
};

export type ImageFormat = "oci" | "docker";

export let container = async (...args: tg.Args<Arg>): Promise<tg.File> => {
	type Apply = {
		cmdString: Array<string> | undefined;
		entrypointArtifact: tg.File | undefined;
		entrypointString: Array<string> | undefined;
		format: ImageFormat;
		rootDir: Array<tg.Directory>;
		system: tg.System;
	};
	let {
		cmdString,
		entrypointArtifact,
		entrypointString,
		format: format_,
		rootDir: rootDirs,
		system: system_,
	} = await tg.Args.apply<Arg, Apply>(args, async (arg) => {
		if (arg === undefined) {
			return {};
		} else if (typeof arg === "string" || tg.Template.is(arg)) {
			// It's a script. Wrap it, use it as the entrypoint.
			return { entrypointArtifact: await std.wrap(arg) };
		} else if (tg.File.is(arg) || tg.Symlink.is(arg)) {
			let file;
			if (tg.Symlink.is(arg)) {
				file = await arg.resolve();
				tg.assert(
					file,
					`Could not resolve symlink ${await arg.id()} to a file.`,
				);
			} else {
				file = arg;
			}
			tg.File.assert(file);
			// Is the file executable? If so, wrap it, use it as the entrypoint.
			let executableMetadata = await std.file.executableMetadata(file);
			if (executableMetadata) {
				return {
					entrypointArtifact: await std.wrap(file),
				};
			} else {
				let id = await file.id();
				throw new Error(`Non-executable file passed to std.container: ${id}.`);
			}
		} else if (tg.Directory.is(arg)) {
			// Add it to the root.
			return {
				rootDir: await tg.Mutation.arrayAppend(arg),
			};
		} else if (typeof arg === "object") {
			let object: tg.MutationMap<Apply> = {};
			if ("executable" in arg && arg.executable !== undefined) {
				object.entrypointArtifact = tg.Mutation.is(arg.executable)
					? arg.executable
					: await std.wrap(arg.executable);
			}
			if ("rootFileSystem" in arg) {
				object.rootDir = tg.Mutation.is(arg.rootFileSystem)
					? arg.rootFileSystem
					: await tg.Mutation.arrayAppend(arg.rootFileSystem);
			}
			if ("cmd" in arg) {
				object.cmdString = arg.cmd;
			}
			if ("entrypoint" in arg) {
				object.entrypointString = arg.entrypoint;
			}
			if ("format" in arg) {
				object.format = arg.format;
			}
			if (arg.system) {
				object.system = tg.Mutation.is(arg.system)
					? arg.system
					: std.Triple.system(std.triple(arg.system));
			}
			return object;
		} else {
			return tg.unreachable();
		}
	});

	// Fill in defaults.
	let format = format_ ?? "oci";
	let system = system_ ?? (await std.Triple.hostSystem());

	// Combine all root dirs.
	let rootDir =
		rootDirs !== undefined ? await tg.directory(...rootDirs) : undefined;

	console.log("rootDir", rootDir ? await rootDir.id() : "undefined");
	console.log(
		"entrypointArtifact",
		entrypointArtifact ? await entrypointArtifact.id() : "undefined",
	);
	console.log("entrypointString", entrypointString);
	console.log("cmdString", cmdString);

	// Verify that the arguments supplied are correct.
	tg.assert(
		rootDir || entrypointArtifact,
		"Cannot create a container image without either a root filesystem or entrypoint.",
	);

	// Create the layers for the image.
	let layers: Array<Layer> = [];
	if (rootDir) {
		layers.push(await layer(rootDir));
	}
	if (entrypointArtifact) {
		layers.push(
			await layer(await tg.directory({ entrypoint: entrypointArtifact })),
		);
		if (!entrypointString) {
			entrypointString = ["/entrypoint"];
		}
	}
	console.log("layers", layers);

	// Create the image configuration.
	let config: ImageConfigV1 = {
		...platform(system),
		rootfs: {
			type: "layers",
			diff_ids: layers.map((l) => l.diffId),
		},
		config: {
			Entrypoint: entrypointString,
			Cmd: cmdString,
		},
	};
	console.log("config", config);

	// Build the container image using the format.
	switch (format) {
		case "oci":
			return oci.image(config, ...layers);
		case "docker":
			return docker.image(config, ...layers);
	}
};

export type Platform = {
	architecture: string;
	os: string;
	"os.version"?: string;
	"os.features"?: Array<string>;
	variant?: string;
	features?: Array<string>;
};

export let platform = (system: tg.System): Platform => {
	switch (system) {
		case "x86_64-linux":
			return {
				architecture: "amd64",
				os: "linux",
			};
		case "aarch64-linux":
			return {
				architecture: "arm64",
				os: "linux",
			};
		default:
			throw new Error(`Unsupported system for OCI image: ${system}`);
	}
};

export type Layer = {
	tar: tg.File;
	diffId: string;
};

export let layer = tg.target(
	async (directory: tg.Directory): Promise<Layer> => {
		console.log("dir pre-bundle", await directory.id());
		let bundle = directory.bundle();
		console.log("dir post-bundle", await (await bundle).id());
		let tar = await std.build(tg`
		mkdir -p ./bundle
		cp -R ${bundle} ./bundle
		tar -chf $OUTPUT ./bundle`);
		tg.File.assert(tar);
		console.log("tarball", await tar.id());
		let bytes = await tar.bytes();
		let diffId = tg.checksum("sha256", bytes);
		console.log("checksum", diffId);
		return { tar, diffId };
	},
);

/** The JSON configuration schema for a container image. This format is shared by both the OCI container image spec and the Docker image spec. */
export type ImageConfigV1 = Platform & {
	config?: ImageExecutionConfig;
	rootfs: {
		type: "layers";
		diff_ids: Array<string>;
	};
	history?: Array<ImageHistory>;
};

/** The execution configuration. */
export type ImageExecutionConfig = {
	User?: string;
	ExposedPorts?: Record<string, {}>;
	Env?: Array<string>;
	Entrypoint?: Array<string>;
	Cmd?: Array<string>;
	Volumes?: Record<string, {}>;
	WorkingDir?: string;
	Labels?: Record<string, string>;
	StopSignal?: string;
	ArgsEscaped?: boolean;
	Memory?: number;
	MemorySwap?: number;
	CpuShares?: number;
	Healthcheck?: Record<string, unknown>;
};

export type ImageHistory = {
	created?: string;
	author?: string;
	created_by?: string;
	comment?: string;
	empty_layer?: boolean;
};

export default container;

import * as bootstrap from "./bootstrap.tg.ts";
export let test = tg.target(async () => {
	return testWrappedEntrypoint();
});

export let testWrappedEntrypoint = tg.target(async () => {
	let shell = tg.File.expect(await (await bootstrap.shell()).get("bin/dash"));
	let script = `echo "hello, world!"`;
	let exe = await std.wrap(script, { interpreter: shell });
	let image = await container(exe);
	return image;
});

export let testBasicRootfs = tg.target(async () => {
	// Test a container with a single file and a shell in it.
	let shell = bootstrap.shell();
	let utils = bootstrap.utils();
	let rootFs = tg.directory(shell, utils, {
		"hello.txt": tg.file("Hello, world!"),
	});
	let image = await container(rootFs, {
		cmd: ["/bin/sh", "-c", "cat /hello.txt"],
	});

	return image;
});
