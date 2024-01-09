import { ImageConfigV1, Layer, Platform } from "../container.tg.ts";
import * as std from "../tangram.tg.ts";

/*
	notes:

	Entrypoint array of strings, OPTIONAL

	A list of arguments to use as the command to execute when the container starts. These values act as defaults and may be replaced by an entrypoint specified when creating a container.

	Cmd array of strings, OPTIONAL

	Default arguments to the entrypoint of the container. These values act as defaults and may be replaced by any specified when creating a container. If an Entrypoint value is not specified, then the first entry of the Cmd array SHOULD be interpreted as the executable to run.


*/

export let image = async (
	dockerCompat: boolean,
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

	// Add the manifest as a blb.
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
