import * as std from "../tangram.tg.ts";
import zstd from "../sdk/dependencies/zstd.tg.ts";

/*
	notes:

	This image format conforms to the OCI spec, and is compatible with container runtimes such as Docker and Podman.

	Entrypoint array of strings, OPTIONAL

	A list of arguments to use as the command to execute when the container starts. These values act as defaults and may be replaced by an entrypoint specified when creating a container.

	Cmd array of strings, OPTIONAL

	Default arguments to the entrypoint of the container. These values act as defaults and may be replaced by any specified when creating a container. If an Entrypoint value is not specified, then the first entry of the Cmd array SHOULD be interpreted as the executable to run.


*/

export type Arg = string | tg.Template | tg.Artifact | ArgObject;

export type ArgObject = (ExecutableArg | RootFsArg) & {
	/** The compression type to use for the image layers. Default: "zstd". */
	layerCompression: "gzip" | "zstd";
	/** The image should target a specific system. If not provided, will detect the host. */
	system?: string;
};

type ExecutableArg = {
	executable: std.wrap.Arg;

	rootFileSystem?: tg.Directory | undefined;
};

type RootFsArg = {
	rootFileSystem: tg.Directory | undefined;

	/** This is the equivalent of the ENTRYPOINT instruction in  Dockerfile. */
	entrypoint?: Array<string>;

	/** This is the equivalent of the CMD instruction in a dockerfile. */
	cmd?: Array<string>;
};

export let image = tg.target(
	async (...args: std.Args<Arg>): Promise<tg.File> => {
		type CombinedArgObject = {
			cmdString?: Array<string>;
			entrypointArtifact?: std.wrap.Arg;
			entrypointString?: Array<string>;
			layerCompression?: "gzip" | "zstd";
			rootDir?: tg.Directory;
			system?: string;
		};
		let objectArgs = await Promise.all(
			std.flatten(args).map(async (arg) => {
				if (arg === undefined) {
					return {};
				} else if (typeof arg === "string" || arg instanceof tg.Template) {
					// It's a script. Wrap it, use it as the entrypoint.
					return { entrypointArtifact: arg };
				} else if (arg instanceof tg.File || arg instanceof tg.Symlink) {
					let file;
					if (arg instanceof tg.Symlink) {
						file = arg.resolve();
						tg.assert(file, `Could not resolve symlink ${arg.id()} to a file.`);
					} else {
						file = arg;
					}
					tg.File.assert(file);
					// Is the file executable? If so, wrap it, use it as the entrypoint.
					let executableMetadata = await std.file.executableMetadata(file);
					if (executableMetadata) {
						return {
							entrypointArtifact: await std.wrap(arg),
						};
					} else {
						let id = arg.id();
						throw new Error(
							`Non-executable file passed to std.container: ${id}.`,
						);
					}
				} else if (arg instanceof tg.Directory) {
					// Add it to the root.
					return {
						rootDir: arg,
					};
				} else {
					let object: std.args.MaybeMutationMap<CombinedArgObject> = {};
					if ("executable" in arg && arg.executable !== undefined) {
						object.entrypointArtifact = arg.executable;
					}
					if ("layerCompression" in arg) {
						object.layerCompression = arg.layerCompression;
					}
					if ("rootFileSystem" in arg && arg.rootFileSystem !== undefined) {
						object.rootDir = arg.rootFileSystem;
					}
					if ("cmd" in arg) {
						object.cmdString = arg.cmd;
					}
					if ("entrypoint" in arg) {
						object.entrypointString = arg.entrypoint;
					}
					if (arg.system) {
						object.system = arg.system;
					}
					return object;
				}
			}),
		);

		let mutationArgs = await std.args.createMutations<
			CombinedArgObject,
			std.args.MakeArrayKeys<
				CombinedArgObject,
				"entrypointArtifact" | "rootDir"
			>
		>(objectArgs, {
			cmdString: "set",
			entrypointArtifact: "append",
			entrypointString: "append",
			layerCompression: "set",
			rootDir: "append",
			system: "set",
		});
		let {
			cmdString = [],
			entrypointArtifact: entrypointArtifact_,
			entrypointString = [],
			layerCompression = "zstd",
			rootDir: rootDirs,
			system: system_,
		} = await std.args.applyMutations(mutationArgs);

		// Fill in defaults.
		let system = std.triple.archAndOs(system_ ?? (await std.triple.host()));

		// Combine all root dirs.
		let rootDir =
			rootDirs !== undefined ? await tg.directory(...rootDirs) : undefined;

		// Wrap entrypoint artifact.
		let entrypointArtifact: tg.File | undefined = undefined;
		if (entrypointArtifact_ !== undefined) {
			let entrypointArtifactArgs = entrypointArtifact_.filter(
				(arg) => arg !== undefined,
			) as Array<std.wrap.Arg>;
			entrypointArtifact = await std.wrap(...entrypointArtifactArgs);
		}

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

		return imageFromLayers(config, layerCompression, ...layers);
	},
);

export let imageFromLayers = async (
	config: ImageConfigV1,
	layerCompression: "gzip" | "zstd",
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
	let compressionCmd = layerCompression === "gzip" ? "gzip -nc" : "zstd -c";
	let mediaType =
		layerCompression === "gzip"
			? MediaTypeV1.imageLayerTarGzip
			: MediaTypeV1.imageLayerTarZstd;
	let additionalArgs = layerCompression === "gzip" ? [] : [{ env: zstd() }];
	let layerDescriptors = await Promise.all(
		layers.map(async (layer) => {
			let file = await std.build(
				tg`${compressionCmd} ${layer.tar} > $OUTPUT`,
				...additionalArgs,
			);
			tg.File.assert(file);
			let descriptor: ImageDescriptor<typeof mediaType> = {
				mediaType,
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
		let bundle = tg.Artifact.bundle(directory);
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
	"os.version"?: string | undefined;
	"os.features"?: Array<string> | undefined;
	variant?: string | undefined;
	features?: Array<string> | undefined;
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
