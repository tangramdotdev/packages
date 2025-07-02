import * as std from "../tangram.ts";
import { gnuEnv } from "../utils/coreutils.tg.ts";

export type Arg = string | tg.Template | tg.Artifact | ArgObject;

export type ArgObject = {
	/** Arguments to use at build time. */
	args?: Array<string>;

	/** The toolchain to use for any intermediate build processes. */
	buildToolchain?: std.env.EnvObject;

	/** This is the equivalent of the CMD instruction in a dockerfile. */
	cmd?: Array<string>;

	/** This is the equivalent of the ENTRYPOINT field in a Dockerfile. If a binary is passed, it will be included at `/entrypoint` and used. If a string array is provided, it will be used instead. */
	entrypoint?: std.wrap.Arg | Array<string>;

	/** Env to include. If present, the entrypoint will be an env with these values set, and the command must be used to run a specific program. */
	env?: std.env.Arg;

	/** Ports to expose. */
	expose?: Array<string>;

	/** The format for the container image, docker or OCI. Default: docker */
	format?: ImageFormat;

	/** Labels to add to the container image metadata. */
	labels?: Record<string, string>;

	/** The compression type to use for the image layers. Default: "zstd". */
	layerCompression: LayerCompressionFormat;

	/** Layers to include. */
	layers?: Array<tg.Directory>;

	/** The image should target a specific system. If not provided, will detect the host. */
	system?: string;

	/** Set user and group ID - this user will be set as the default user for the container */
	user?: string;

	/** Create additional users in the container without setting them as the default user. Each user can be specified as "username", "username:group", "username:group:uid:gid", or a UserSpec object. */
	users?: Array<string | UserSpec>;

	/** The WORKDIR field in a Dockerfile. Change to this directory to do work. */
	workdir?: string;
};

export type UserSpec = {
	/** Username */
	name: string;
	/** Group name (defaults to username) */
	group?: string;
	/** User ID (defaults to 1000 for non-root users) */
	uid?: number;
	/** Group ID (defaults to uid) */
	gid?: number;
	/** Home directory (defaults to /home/username for non-root users) */
	home?: string;
	/** Shell (defaults to /bin/sh) */
	shell?: string;
};

export type ImageFormat = "docker" | "oci";

export type LayerCompressionFormat = "gz" | "zst";

export const image = async (...args: std.Args<Arg>): Promise<tg.File> => {
	const arg = await std.args.apply<Arg, ArgObject>({
		args,
		map: async (arg) => {
			if (arg === undefined) {
				return {};
			} else if (typeof arg === "string" || arg instanceof tg.Template) {
				// It's a script. Wrap it, use it as the entrypoint.
				return { entrypoint: arg };
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
						entrypoint: file,
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
					layers: [arg],
				};
			} else {
				const object: tg.MaybeMutationMap<ArgObject> = {};
				if ("args" in arg && arg.args !== undefined) {
					object.args = arg.args;
				}
				if ("buildToolchain" in arg && arg.buildToolchain !== undefined) {
					object.buildToolchain = arg.buildToolchain;
				}
				if ("cmd" in arg && arg.cmd !== undefined) {
					object.cmd = arg.cmd;
				}
				if ("entrypoint" in arg && arg.entrypoint !== undefined) {
					object.entrypoint = arg.entrypoint;
				}
				if ("env" in arg && arg.env !== undefined) {
					object.env = arg.env;
				}
				if ("expose" in arg && arg.expose === undefined) {
					object.expose = arg.expose;
				}
				if ("format" in arg && arg.format !== undefined) {
					object.format = arg.format;
				}
				if ("labels" in arg && arg.labels !== undefined) {
					object.labels = arg.labels;
				}
				if ("layerCompression" in arg && arg.layerCompression !== undefined) {
					object.layerCompression = arg.layerCompression;
				}
				if ("layers" in arg && arg.layers !== undefined) {
					object.layers = arg.layers;
				}
				if ("system" in arg && arg.system !== undefined) {
					object.system = arg.system;
				}
				if ("user" in arg && arg.user !== undefined) {
					object.user = arg.user;
				}
				if ("users" in arg && arg.users !== undefined) {
					object.users = arg.users;
				}
				if ("workdir" in arg && arg.workdir !== undefined) {
					object.workdir = arg.workdir;
				}
				return object;
			}
		},
		reduce: {
			args: "append",
			buildToolchain: "set",
			cmd: "append",
			entrypoint: "set",
			env: (a, b) => std.env.arg(a, b, { utils: false }),
			expose: "append",
			format: "set",
			labels: "set",
			layerCompression: "set",
			layers: "append",
			system: "set",
			user: "set",
			users: "append",
			workdir: "set",
		},
	});

	const {
		buildToolchain,
		cmd = [],
		env: envArg,
		format = "docker",
		entrypoint: entrypoint_,
		expose,
		labels,
		layerCompression: layerCompression_,
		layers: layers_ = [],
		system: system_,
		user,
		users,
		workdir,
	} = arg;
	const env = await std.env.arg(envArg, { utils: false });

	// Fill in defaults.
	const system = std.triple.archAndOs(system_ ?? (await std.triple.host()));
	const layerCompression =
		format === "docker" ? undefined : (layerCompression_ ?? "zst");

	// Wrap entrypoint artifact.
	// If we have an Array<string>, use that.
	let entrypointArtifact: tg.File | undefined = undefined;
	let entrypointString: Array<string> | undefined = undefined;
	let envApplied = false;
	if (entrypoint_ !== undefined) {
		if (Array.isArray(entrypoint_)) {
			entrypointString = entrypoint_;
		} else {
			// Add the env to the entrypoint.
			envApplied = true;
			entrypointArtifact = await std.wrap(entrypoint_, { buildToolchain, env });
		}
	}

	// // Verify that the arguments supplied are correct.
	tg.assert(
		layers_.length > 0 || entrypointArtifact !== undefined,
		"Cannot create a container image without either a root filesystem or entrypoint.",
	);

	// Create the layers for the image.
	// We will always have a rootfs and an entrypoint, we need to determine appropriate values based on the combined args.
	const layers: Array<Layer> = [];
	for (let layerDir of layers_) {
		layers.push(await layer(layerDir, layerCompression));
	}
	if (entrypointArtifact) {
		await entrypointArtifact.store();
		layers.push(
			await layer(
				await tg.directory({ entrypoint: entrypointArtifact }),
				layerCompression,
			),
		);
		if (!entrypointString) {
			entrypointString = ["/entrypoint"];
		}
	}
	if (!envApplied) {
		envApplied = true;
		let envEntrypoint = await std.wrap(gnuEnv(), { buildToolchain, env });
		layers.push(
			await layer(
				await tg.directory({ entrypoint: envEntrypoint }),
				layerCompression,
			),
		);
		if (!entrypointString) {
			entrypointString = ["/entrypoint"];
		}
	}

	// Add user layers if users or user is specified
	if (users !== undefined && users.length > 0) {
		const userLayer = await createUsersLayer(users);
		layers.push(await layer(userLayer, layerCompression));
	}

	// Add user layer if user is specified (for backward compatibility and default user setting)
	if (user !== undefined) {
		const userLayer = await createUserLayer(user);
		layers.push(await layer(userLayer, layerCompression));
	}

	tg.assert(envApplied);

	// Create the image configuration.
	const config: ImageConfigV1 = {
		...platform(system),
		rootfs: {
			type: "layers",
			diff_ids: layers.map((l) => l.diffId),
		},
		config: {
			Entrypoint: entrypointString ?? [],
			Cmd: cmd,
		},
	};
	if (expose !== undefined) {
		config.config!.ExposedPorts = Object.fromEntries(
			expose.map((key) => [key, {}]),
		);
	}
	if (user !== undefined) {
		config.config!.User = user;
	}
	if (workdir !== undefined) {
		config.config!.WorkingDir = workdir;
	}
	if (labels !== undefined) {
		config.config!.Labels = labels;
	}

	if (format === "docker") {
		return dockerImageFromLayers(config, ...layers);
	} else if (format === "oci") {
		tg.assert(layerCompression !== undefined);
		return ociImageFromLayers(config, layerCompression, ...layers);
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
	config: ImageConfigV1,
	layerCompression: LayerCompressionFormat,
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
	const mediaType =
		layerCompression === "gz"
			? MediaTypeV1.imageLayerTarGzip
			: MediaTypeV1.imageLayerTarZstd;
	const layerDescriptors = await Promise.all(
		layers.map(async (layer) => {
			const descriptor: ImageDescriptor<typeof mediaType> = {
				mediaType,
				platform,
				...(await addBlob(layer.tarball)),
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

export const layer = async (
	directory: tg.Directory,
	compressionFormat?: LayerCompressionFormat,
): Promise<Layer> => {
	const bundle = await tg.bundle(directory).then(tg.Directory.expect);
	await bundle.store();
	const tarball = await createTarball(bundle, compressionFormat);
	await tarball.store();
	const bytes = await tarball.bytes();
	const diffId = await tg.checksum(bytes, "sha256");
	return { tarball, diffId };
};

export const createTarball = async (
	directory: tg.Unresolved<tg.Directory>,
	compressionFormat?: LayerCompressionFormat,
): Promise<tg.File> => {
	const resolved = await tg.resolve(directory);
	return await tg.archive(resolved, "tar", compressionFormat).then(tg.file);
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

const createUserLayer = async (username: string): Promise<tg.Directory> => {
	return createUsersLayer([username]);
};

const createUsersLayer = async (
	userSpecs: Array<string | UserSpec>,
): Promise<tg.Directory> => {
	const passwdEntries: Array<string> = [];
	const groupEntries: Array<string> = [];
	const homeDirs: Record<string, tg.Directory> = {};

	let nextUid = 1000;

	for (const userSpec of userSpecs) {
		let user: string,
			group: string,
			uid: number,
			gid: number,
			home: string,
			shell: string;

		if (typeof userSpec === "string") {
			// Parse string format: "username", "username:group", "username:group:uid:gid"
			const parts = userSpec.split(":");
			tg.assert(parts[0]);
			user = parts[0];
			tg.assert(user !== undefined, "Username cannot be empty");
			group = parts[1] ?? user;
			uid = parts[2] ? parseInt(parts[2], 10) : user === "root" ? 0 : nextUid++;
			gid = parts[3] ? parseInt(parts[3], 10) : uid;
			home = user === "root" ? "/root" : `/home/${user}`;
			shell = "/bin/sh";
		} else {
			// UserSpec object
			user = userSpec.name;
			group = userSpec.group ?? user;
			uid = userSpec.uid ?? (user === "root" ? 0 : nextUid++);
			gid = userSpec.gid ?? uid;
			home = userSpec.home ?? (user === "root" ? "/root" : `/home/${user}`);
			shell = userSpec.shell ?? "/bin/sh";
		}

		// Create passwd entry
		passwdEntries.push(`${user}:x:${uid}:${gid}:${user}:${home}:${shell}`);

		// Create group entry
		groupEntries.push(`${group}:x:${gid}:`);

		// Create home directory (except for root)
		if (user !== "root") {
			homeDirs[user] = await tg.directory();
		}
	}

	// Create shell wrapper script that calls /entrypoint sh
	const shellWrapper = tg.file(`#!/entrypoint sh\nexec /entrypoint sh "$@"`, {
		executable: true,
	});

	// Create the user layer directory structure
	const userDir = tg.directory({
		bin: {
			sh: shellWrapper,
		},
		etc: {
			passwd: tg.file(passwdEntries.join("\n") + "\n"),
			group: tg.file(groupEntries.join("\n") + "\n"),
		},
		home: homeDirs,
	});

	return userDir;
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
