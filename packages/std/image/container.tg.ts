import * as std from "../tangram.ts";
import * as bootstrap from "../bootstrap.tg.ts";
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
	/** The toolchain to use for any intermediate build processes. */
	buildToolchain?: std.env.EnvObject;
	/** The format for the container image, docker or OCI. Default: docker */
	format?: ImageFormat;
	/** The compression type to use for the image layers. Default: "zstd". */
	layerCompression: "gzip" | "zstd";
	/** The image should target a specific system. If not provided, will detect the host. */
	system?: string;
};

export type ImageFormat = "docker" | "oci";

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

export const image = async (...args: std.Args<Arg>): Promise<tg.File> => {
	type CombinedArgObject = {
		buildToolchain?: std.env.EnvObject;
		cmdString?: Array<string>;
		format?: ImageFormat;
		entrypointArtifact?: std.wrap.Arg | undefined;
		entrypointString?: Array<string>;
		layerCompression?: "gzip" | "zstd";
		rootDir?: tg.Directory;
		system?: string;
	};
	const arg = await std.args.apply<Arg, CombinedArgObject>({
		args,
		map: async (arg) => {
			if (arg === undefined) {
				return {};
			} else if (typeof arg === "string" || arg instanceof tg.Template) {
				// It's a script. Wrap it, use it as the entrypoint.
				return { entrypointArtifact: arg };
			} else if (arg instanceof tg.File || arg instanceof tg.Symlink) {
				let file;
				if (arg instanceof tg.Symlink) {
					file = arg.resolve();
					tg.assert(file, `Could not resolve symlink ${arg.id} to a file.`);
				} else {
					file = arg;
				}
				tg.File.assert(file);
				// Is the file executable? If so, wrap it, use it as the entrypoint.
				const executableMetadata = await std.file.executableMetadata(file);
				if (executableMetadata) {
					return {
						entrypointArtifact: file,
					};
				} else {
					await arg.store();
					const id = arg.id;
					throw new Error(
						`Non-executable file passed to std.container: ${id}.`,
					);
				}
			} else if (arg instanceof tg.Directory) {
				return {
					rootDir: arg,
				};
			} else {
				const object: tg.MaybeMutationMap<CombinedArgObject> = {};
				if ("buildToolchain" in arg && arg.buildToolchain !== undefined) {
					object.buildToolchain = arg.buildToolchain;
				}
				if ("executable" in arg && arg.executable !== undefined) {
					object.entrypointArtifact = arg.executable;
				}
				if ("format" in arg) {
					object.format = arg.format;
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
		},
		reduce: {
			buildToolchain: "set",
			cmdString: "set",
			format: "set",
			entrypointArtifact: (a, b) => {
				if (a === undefined) {
					return b;
				} else if (b === undefined) {
					return a;
				} else {
					return std.wrap.arg(a, b);
				}
			},
			entrypointString: "append",
			rootDir: (a, b) => tg.directory(a, b),
			system: "set",
		},
	});

	let {
		buildToolchain,
		cmdString = [],
		format = "docker",
		entrypointArtifact: entrypointArtifact_,
		entrypointString,
		layerCompression = "zstd",
		rootDir: rootDir_,
		system: system_,
	} = arg;

	// Fill in defaults.
	const system = std.triple.archAndOs(system_ ?? (await std.triple.host()));
	const rootDir = rootDir_ !== undefined ? rootDir_ : undefined;

	// Wrap entrypoint artifact.
	let entrypointArtifact: tg.File | undefined = undefined;
	if (entrypointArtifact_ !== undefined) {
		entrypointArtifact = await std.wrap(
			{ buildToolchain },
			entrypointArtifact_,
		);
	}

	// Verify that the arguments supplied are correct.
	tg.assert(
		rootDir || entrypointArtifact,
		"Cannot create a container image without either a root filesystem or entrypoint.",
	);

	// Create the layers for the image.
	const layers: Array<Layer> = [];
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
	const config: ImageConfigV1 = {
		...platform(system),
		rootfs: {
			type: "layers",
			diff_ids: layers.map((l) => l.diffId),
		},
		config: {
			Entrypoint: entrypointString ?? [],
			Cmd: cmdString,
		},
	};

	if (format === "docker") {
		return dockerImageFromLayers(config, ...layers);
	} else if (format === "oci") {
		return ociImageFromLayers(
			buildToolchain,
			config,
			layerCompression,
			...layers,
		);
	} else {
		throw new Error(`Unsupported image format: ${format}`);
	}
};

export const dockerImageFromLayers = async (
	config: ImageConfigV1,
	...layers: Array<Layer>
): Promise<tg.File> => {
	// Create an empty image directory.
	let image = tg.directory();

	// Add the config file to the image, using its checksum value as a filename.
	const configFile = await tg.file(tg.encoding.json.encode(config));
	const configFilename = `${(
		await tg.checksum(await configFile.bytes(), "sha256")
	).slice("sha256:".length)}.json`;
	image = tg.directory(image, {
		[configFilename]: configFile,
	});

	// Add each layer file to the image directory.
	const layerFilenames = await Promise.all(
		layers.map(async (layer) => {
			const bytes = await layer.tarball.bytes();
			const size = bytes.length;
			const checksum = await tg.checksum(bytes, "sha256");
			const checksumValue = checksum.slice("sha256:".length);

			// Add the layer to the image directory, along with the legacy metadata used by older versions of the Docker image spec.
			image = tg.directory(image, {
				[checksumValue]: {
					"layer.tar": layer.tarball,
					json: tg.encoding.json.encode({
						// Use the checksum as a unique layer ID.
						id: checksumValue,

						// The v1.0 Docker image spec uses TarSum for the legacy metadata checksum, but the legacy metadata isn't used by newer versions of Docker. So for now, we use the checksum we already have. To properly support older versions of Docker or other tools that expect this legacy format, we could switch to TarSum for this checksum instead.
						checksum,

						// Add the legacy metadata.
						architecture: config.architecture,
						os: config.os,
						config: config.config,
						Size: size,
						author: "Tangram",
						created: "1970-01-01T00:00:00+00:00",
					}),
				},
			});

			return `${checksumValue}/layer.tar`;
		}),
	);

	// The manifest is an array of manifest entries containing the Config, Layers, and Repotags.
	const manifest = [
		{
			Config: configFilename,
			Layers: layerFilenames,
			RepoTags: [],
		},
	];

	// Add the manifest, along with the legacy `repositories` file.
	image = tg.directory(image, {
		"manifest.json": tg.encoding.json.encode(manifest),
		repositories: tg.encoding.json.encode({}),
	});

	// Create a `.tar` file of the Docker image. This is the format that `docker load` expects.
	return await createTarball(image);
};

export const ociImageFromLayers = async (
	buildToolchain: std.env.Arg | undefined,
	config: ImageConfigV1,
	layerCompression: "gzip" | "zstd",
	...layers: Array<Layer>
): Promise<tg.File> => {
	let blobs = tg.directory();

	const addBlob = async (file: tg.File) => {
		const bytes = await file.bytes();
		const checksum = await tg.checksum(bytes, "sha256");
		blobs = tg.directory(blobs, {
			[checksum.replace(":", "/")]: file,
		});
		return { digest: checksum, size: bytes.length };
	};

	const platform: Platform = {
		os: config.os,
		architecture: config.architecture,
		variant: config.variant,
		"os.features": config["os.features"],
		"os.version": config["os.version"],
		features: config.features,
	};

	// Add the config as a blob.
	const configDescriptor: ImageDescriptor<typeof MediaTypeV1.imageConfig> = {
		mediaType: MediaTypeV1.imageConfig,
		platform,
		...(await addBlob(await tg.file(tg.encoding.json.encode(config)))),
	};

	// Add the layers as blobs.
	const compressionCmd = layerCompression === "gzip" ? "gzip -nc" : "zstd -c";
	const mediaType =
		layerCompression === "gzip"
			? MediaTypeV1.imageLayerTarGzip
			: MediaTypeV1.imageLayerTarZstd;
	const additionalEnv: tg.Unresolved<Array<std.env.Arg>> = [];
	if (buildToolchain === undefined) {
		additionalEnv.push(
			bootstrap.sdk(),
			std.utils.env({ env: bootstrap.sdk() }),
		);
	} else {
		additionalEnv.push(buildToolchain);
	}
	if (layerCompression === "zstd") {
		additionalEnv.push(
			zstd({
				bootstrap: true,
				env: await std.env.arg(...additionalEnv, { utils: false }),
			}),
		);
	}
	const layerDescriptors = await Promise.all(
		layers.map(async (layer) => {
			const file =
				await std.build`${compressionCmd} $(realpath ${layer.tarball}) > $OUTPUT`
					.bootstrap(true)
					.env(...additionalEnv)
					.then(tg.File.expect);
			const descriptor: ImageDescriptor<typeof mediaType> = {
				mediaType,
				platform,
				...(await addBlob(file)),
			};
			return descriptor;
		}),
	);

	// Create the container image manifest.
	const manifest: ImageManifestV1 = {
		mediaType: MediaTypeV1.imageManifest,
		schemaVersion: 2,
		config: configDescriptor,
		layers: layerDescriptors,
	};

	// Add the manifest as a blob.
	const manifestDescriptor: ImageDescriptor<typeof MediaTypeV1.imageManifest> =
		{
			mediaType: MediaTypeV1.imageManifest,
			platform,
			...(await addBlob(await tg.file(tg.encoding.json.encode(manifest)))),
		};

	// Create the OCI directory according to the layout specification.
	const directory = tg.directory({
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
	return await createTarball(directory);
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
	tarball: tg.File;
	diffId: string;
};

export const layer = async (directory: tg.Directory): Promise<Layer> => {
	const bundle = await tg.bundle(directory).then(tg.Directory.expect);
	await bundle.store();
	console.log("bundle", bundle.id);
	const tarball = await createTarball(bundle);
	await tarball.store();
	console.log("layer", tarball.id);
	const bytes = await tarball.bytes();
	const diffId = await tg.checksum(bytes, "sha256");
	return { tarball, diffId };
};

export const createTarball = async (
	directory: tg.Unresolved<tg.Directory>,
): Promise<tg.File> => {
	const resolved = await tg.resolve(directory);
	return await tg.archive(resolved, "tar").then(tg.file);
};

export type Platform = {
	architecture: string;
	os: string;
	"os.version"?: string | undefined;
	"os.features"?: Array<string> | undefined;
	variant?: string | undefined;
	features?: Array<string> | undefined;
};

export const platform = (system: string): Platform => {
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
