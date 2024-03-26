import * as std from "../tangram.tg.ts";

/*
	notes:

	This image format conforms to the OCI spec, and is compatible with container runtimes such as Docker and Podman.

	Entrypoint array of strings, OPTIONAL

	A list of arguments to use as the command to execute when the container starts. These values act as defaults and may be replaced by an entrypoint specified when creating a container.

	Cmd array of strings, OPTIONAL

	Default arguments to the entrypoint of the container. These values act as defaults and may be replaced by any specified when creating a container. If an Entrypoint value is not specified, then the first entry of the Cmd array SHOULD be interpreted as the executable to run.


*/

export type Arg = (ExecutableArg | RootFsArg) & {
	/** The image should target a specific system. If not provided, will detect the host. */
	system?: string;
};

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

export let image = async (...args: tg.Args<Arg>): Promise<tg.File> => {
	type Apply = {
		cmdString: Array<string>;
		entrypointArtifact: tg.File;
		entrypointString: Array<string>;
		rootDir: Array<tg.Directory>;
		system: string;
	};
	let {
		cmdString,
		entrypointArtifact,
		entrypointString,
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
			if (arg.system) {
				object.system = tg.Mutation.is(arg.system)
					? arg.system
					: std.triple.archAndOs(arg.system);
			}
			return object;
		} else {
			return tg.unreachable();
		}
	});

	// Fill in defaults.
	let system = system_ ?? (await std.triple.host());

	// Combine all root dirs.
	let rootDir =
		rootDirs !== undefined ? await tg.directory(...rootDirs) : undefined;

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

	return imageFromLayers(config, ...layers);
};

export let imageFromLayers = async (
	config: ImageConfigV1,
	...layers: Array<Layer>
): Promise<tg.File> => {
	let blobs = tg.directory();

	let addBlob = async (file: tg.File) => {
		let bytes = await file.bytes();
		let checksum = tg.checksum("sha256", bytes);
		blobs = tg.directory(blobs, {
			[checksum.replace(":", "/")]: file,
		});
		return { digest: checksum, size: bytes.length };
	};

	let platform: Platform = {
		os: config.os,
		architecture: config.architecture,
		variant: config.variant,
		"os.features": config["os.features"],
		"os.version": config["os.version"],
		features: config.features,
	};

	// Add the config as a blob.
	let configDescriptor: ImageDescriptor<typeof MediaTypeV1.imageConfig> = {
		mediaType: MediaTypeV1.imageConfig,
		platform,
		...(await addBlob(await tg.file(tg.encoding.json.encode(config)))),
	};

	// Add the layers as blobs.
	let layerDescriptors = await Promise.all(
		layers.map(async (layer) => {
			let file = await std.build(tg`gzip -nc ${layer.tar} > $OUTPUT`);
			tg.File.assert(file);
			let descriptor: ImageDescriptor<typeof MediaTypeV1.imageLayerTarGzip> = {
				mediaType: MediaTypeV1.imageLayerTarGzip,
				platform,
				...(await addBlob(file)),
			};
			return descriptor;
		}),
	);

	// Create the container image manifest.
	let manifest: ImageManifestV1 = {
		mediaType: MediaTypeV1.imageManifest,
		schemaVersion: 2,
		config: configDescriptor,
		layers: layerDescriptors,
	};

	// Add the manifest as a blob.
	let manifestDescriptor: ImageDescriptor<typeof MediaTypeV1.imageManifest> = {
		mediaType: MediaTypeV1.imageManifest,
		platform,
		...(await addBlob(await tg.file(tg.encoding.json.encode(manifest)))),
	};

	// Create the OCI directory according to the layout specification.
	let directory = tg.directory({
		blobs,
		"oci-layout": tg.file(
			tg.encoding.json.encode({
				imageLayoutVersion: "1.0.0",
			}),
		),
		"index.json": tg.file(
			tg.encoding.json.encode({
				schemaVersion: 2,
				mediaType: MediaTypeV1.imageIndex,
				manifests: [manifestDescriptor],
			}),
		),
	});

	// Tar the result and return it.
	let image = await std.build(tg`tar -cf $OUTPUT -C ${directory} .`);
	tg.File.assert(image);
	return image;
};

/**
 * Specification: https://github.com/opencontainers/image-spec/blob/main/manifest.md#image-manifest-property-descriptions
 */
type ImageManifestV1 = {
	schemaVersion: 2;
	mediaType: typeof MediaTypeV1.imageManifest;
	config: ImageDescriptor<typeof MediaTypeV1.imageConfig>;
	layers: Array<ImageDescriptor>;
	subject?: ImageDescriptor<typeof MediaTypeV1.imageManifest>;
	annotations?: Record<string, string>;
	platform?: Platform;
};

type ImageDescriptor<MediaType = string> = {
	mediaType: MediaType;
	digest: string;
	size: number;
	urls?: Array<string>;
	annotations?: Record<string, string>;
	data?: string;
	platform?: Platform;
};

export type Layer = {
	tar: tg.File;
	diffId: string;
};

export let layer = tg.target(
	async (directory: tg.Directory): Promise<Layer> => {
		let bundle = directory.bundle();
		let tar = await std.build(tg`tar -cf $OUTPUT -C ${bundle} .`);
		tg.File.assert(tar);
		let bytes = await tar.bytes();
		let diffId = tg.checksum("sha256", bytes);
		return { tar, diffId };
	},
);

export type Platform = {
	architecture: string;
	os: string;
	"os.version"?: string;
	"os.features"?: Array<string>;
	variant?: string;
	features?: Array<string>;
};

export let platform = (system: string): Platform => {
	switch (std.triple.archAndOs(system)) {
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

export namespace MediaTypeV1 {
	export const descriptor = "application/vnd.oci.descriptor.v1+json";
	export const layoutHeader = "application/vnd.oci.layout.header.v1+json";
	export const imageIndex = "application/vnd.oci.image.index.v1+json";
	export const imageManifest = "application/vnd.oci.image.manifest.v1+json";
	export const imageConfig = "application/vnd.oci.image.config.v1+json";
	export const imageLayerTar = "application/vnd.oci.image.layer.v1.tar";
	export const imageLayerTarGzip =
		"application/vnd.oci.image.layer.v1.tar+gzip";
	export const imageLayerTarZstd =
		"application/vnd.oci.image.layer.v1.tar+zstd";
	export const scratch = "application/vnd.oci.scratch.v1+json";
	export const imageLayerNondistributableTar =
		"application/vnd.oci.image.layer.nondistributable.v1.tar";
	export const imageLayerNondistributableTarGzip =
		"application/vnd.oci.image.layer.nondistributable.v1.tar+gzip";
	export const imageLayerNondistributableTarZstd =
		"application/vnd.oci.image.layer.nondistributable.v1.tar+zstd";
}
