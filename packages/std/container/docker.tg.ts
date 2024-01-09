import { ImageConfigV1, ImageExecutionConfig, Layer } from "../container.tg.ts";
import * as std from "../tangram.tg.ts";

export let image = async (
	config: ImageConfigV1,
	...layers: Array<Layer>
): Promise<tg.File> => {
	// Create an empty image directory.
	let image = tg.directory();

	// Add the config file to the image, using its checksum value as a filename.
	let configFile = await tg.file(tg.encoding.json.encode(config));
	let configFilename = `${tg
		.checksum("sha256", await configFile.bytes())
		.slice("sha256:".length)}.json`;
	image = tg.directory(image, {
		[configFilename]: configFile,
	});

	// Add each layer file to the image directory.
	let layerFilenames = await Promise.all(
		layers.map(async (layer) => {
			let bytes = await layer.tar.bytes();
			let size = bytes.length;
			let checksum = tg.checksum("sha256", bytes);
			let checksumValue = checksum.slice("sha256:".length);

			// Add the layer to the image directory, along with the legacy metadata used by older versions of the Docker image spec.
			image = tg.directory(image, {
				[checksumValue]: {
					"layer.tar": layer.tar,
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
	let manifest = [
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
	let tar = await std.build(tg`tar -cf $OUTPUT -C ${image} .`);
	tg.File.assert(tar);
	return tar;
};
